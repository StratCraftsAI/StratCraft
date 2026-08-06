/**
 * Plugin Loader Implementation
 *
 * TICKET_251_2: Dynamic plugin loading mechanism
 */

#include "quantnexus/executor/plugin_loader.hpp"

#include <fstream>
#include <stdexcept>

// Platform-specific dynamic loading
#ifdef _WIN32
    #include <windows.h>
    #define LOAD_LIBRARY(path) LoadLibraryA(path)
    #define GET_SYMBOL(handle, name) GetProcAddress(static_cast<HMODULE>(handle), name)
    #define UNLOAD_LIBRARY(handle) FreeLibrary(static_cast<HMODULE>(handle))
    #define LIBRARY_ERROR() std::to_string(GetLastError())
#else
    #include <dlfcn.h>
    #define LOAD_LIBRARY(path) dlopen(path, RTLD_NOW | RTLD_LOCAL)
    #define GET_SYMBOL(handle, name) dlsym(handle, name)
    #define UNLOAD_LIBRARY(handle) dlclose(handle)
    #define LIBRARY_ERROR() (dlerror() ? dlerror() : "unknown error")
#endif

namespace StratCraft::executor {

namespace {

// Manifest filename
constexpr const char* MANIFEST_FILENAME = "manifest.json";

// Symbol names for plugin exports
constexpr const char* SYMBOL_CREATE_PLUGIN = "create_plugin";
constexpr const char* SYMBOL_DESTROY_PLUGIN = "destroy_plugin";
constexpr const char* SYMBOL_PLUGIN_VERSION = "plugin_version";

} // anonymous namespace

// =============================================================================
// Singleton
// =============================================================================

PluginLoader& PluginLoader::instance() {
    static PluginLoader instance;
    return instance;
}

PluginLoader::~PluginLoader() {
    unloadAll();
}

// =============================================================================
// Plugin Discovery
// =============================================================================

void PluginLoader::scanPlugins(const std::filesystem::path& pluginDir) {
    std::lock_guard<std::mutex> lock(mutex_);

    if (!std::filesystem::exists(pluginDir)) {
        return;
    }

    for (const auto& entry : std::filesystem::directory_iterator(pluginDir)) {
        if (!entry.is_directory()) {
            continue;
        }

        auto manifestPath = entry.path() / MANIFEST_FILENAME;
        if (!std::filesystem::exists(manifestPath)) {
            continue;
        }

        try {
            std::ifstream file(manifestPath);
            if (!file.is_open()) {
                continue;
            }

            nlohmann::json j;
            file >> j;

            PluginManifest manifest = j.get<PluginManifest>();

            DiscoveredPlugin discovered;
            discovered.directory = entry.path();
            discovered.manifest = std::move(manifest);

            discoveredPlugins_[discovered.manifest.name] = std::move(discovered);

        } catch (const std::exception&) {
            // Skip invalid manifests
            continue;
        }
    }
}

std::vector<std::string> PluginLoader::listPlugins() const {
    std::lock_guard<std::mutex> lock(mutex_);

    std::vector<std::string> names;
    names.reserve(builtinPlugins_.size() + discoveredPlugins_.size());

    for (const auto& [name, _] : builtinPlugins_) {
        names.push_back(name);
    }

    for (const auto& [name, _] : discoveredPlugins_) {
        // Avoid duplicates if a discovered plugin shadows a built-in
        if (builtinPlugins_.find(name) == builtinPlugins_.end()) {
            names.push_back(name);
        }
    }

    return names;
}

bool PluginLoader::hasPlugin(std::string_view name) const {
    std::lock_guard<std::mutex> lock(mutex_);

    std::string nameStr(name);
    return builtinPlugins_.contains(nameStr) ||
           discoveredPlugins_.contains(nameStr) ||
           loadedPlugins_.contains(nameStr);
}

// =============================================================================
// Plugin Loading
// =============================================================================

IExecutorPlugin* PluginLoader::loadPlugin(std::string_view name) {
    std::lock_guard<std::mutex> lock(mutex_);

    std::string nameStr(name);

    // Check if already loaded
    if (auto it = loadedPlugins_.find(nameStr); it != loadedPlugins_.end()) {
        return it->second.instance;
    }

    // Check built-in plugins
    if (auto it = builtinPlugins_.find(nameStr); it != builtinPlugins_.end()) {
        return it->second.get();
    }

    // Check discovered plugins
    auto it = discoveredPlugins_.find(nameStr);
    if (it == discoveredPlugins_.end()) {
        return nullptr;
    }

    // Load dynamic plugin
    try {
        LoadedPlugin loaded = loadDynamicPlugin(it->second);
        IExecutorPlugin* instance = loaded.instance;
        loadedPlugins_[nameStr] = std::move(loaded);
        return instance;
    } catch (const std::exception&) {
        return nullptr;
    }
}

void PluginLoader::unloadPlugin(std::string_view name) {
    std::lock_guard<std::mutex> lock(mutex_);

    std::string nameStr(name);
    auto it = loadedPlugins_.find(nameStr);
    if (it == loadedPlugins_.end()) {
        return;
    }

    LoadedPlugin& loaded = it->second;

    // Cannot unload built-in plugins
    if (loaded.isBuiltin) {
        return;
    }

    // Destroy instance
    if (loaded.instance && loaded.destroy) {
        loaded.destroy(loaded.instance);
    }

    // Unload library
    if (loaded.handle) {
        UNLOAD_LIBRARY(loaded.handle);
    }

    loadedPlugins_.erase(it);
}

void PluginLoader::unloadAll() {
    std::lock_guard<std::mutex> lock(mutex_);

    for (auto& [name, loaded] : loadedPlugins_) {
        if (loaded.isBuiltin) {
            continue;
        }

        if (loaded.instance && loaded.destroy) {
            loaded.destroy(loaded.instance);
        }

        if (loaded.handle) {
            UNLOAD_LIBRARY(loaded.handle);
        }
    }

    loadedPlugins_.clear();
}

// =============================================================================
// Built-in Plugin Registration
// =============================================================================

void PluginLoader::registerBuiltinPlugin(std::unique_ptr<IExecutorPlugin> plugin) {
    std::lock_guard<std::mutex> lock(mutex_);

    if (!plugin) {
        return;
    }

    std::string name(plugin->name());
    builtinPlugins_[name] = std::move(plugin);
}

IExecutorPlugin* PluginLoader::getBuiltinPlugin(std::string_view name) const {
    std::lock_guard<std::mutex> lock(mutex_);

    std::string nameStr(name);
    auto it = builtinPlugins_.find(nameStr);
    if (it != builtinPlugins_.end()) {
        return it->second.get();
    }
    return nullptr;
}

// =============================================================================
// Plugin Info
// =============================================================================

std::optional<PluginManifest> PluginLoader::getManifest(std::string_view name) const {
    std::lock_guard<std::mutex> lock(mutex_);

    std::string nameStr(name);

    // Check loaded plugins first
    if (auto it = loadedPlugins_.find(nameStr); it != loadedPlugins_.end()) {
        return it->second.manifest;
    }

    // Check discovered plugins
    if (auto it = discoveredPlugins_.find(nameStr); it != discoveredPlugins_.end()) {
        return it->second.manifest;
    }

    return std::nullopt;
}

bool PluginLoader::isLoaded(std::string_view name) const {
    std::lock_guard<std::mutex> lock(mutex_);

    std::string nameStr(name);

    // Built-in plugins are always "loaded"
    if (builtinPlugins_.contains(nameStr)) {
        return true;
    }

    return loadedPlugins_.contains(nameStr);
}

// =============================================================================
// Internal Methods
// =============================================================================

PluginLoader::LoadedPlugin PluginLoader::loadDynamicPlugin(const DiscoveredPlugin& discovered) {
    // Build library path
    std::string libFilename = getLibraryFilename(discovered.manifest.libraryName);
    auto libPath = discovered.directory / "lib" / libFilename;

    if (!std::filesystem::exists(libPath)) {
        throw std::runtime_error("Plugin library not found: " + libPath.string());
    }

    // Load library
    void* handle = LOAD_LIBRARY(libPath.string().c_str());
    if (!handle) {
        throw std::runtime_error("Failed to load library: " + std::string(LIBRARY_ERROR()));
    }

    // Get symbols
    auto createFunc = reinterpret_cast<CreatePluginFunc>(
        GET_SYMBOL(handle, SYMBOL_CREATE_PLUGIN));
    auto destroyFunc = reinterpret_cast<DestroyPluginFunc>(
        GET_SYMBOL(handle, SYMBOL_DESTROY_PLUGIN));

    if (!createFunc || !destroyFunc) {
        UNLOAD_LIBRARY(handle);
        throw std::runtime_error("Plugin missing required symbols");
    }

    // Create instance
    IExecutorPlugin* instance = createFunc();
    if (!instance) {
        UNLOAD_LIBRARY(handle);
        throw std::runtime_error("Plugin creation failed");
    }

    LoadedPlugin loaded;
    loaded.handle = handle;
    loaded.instance = instance;
    loaded.destroy = destroyFunc;
    loaded.isBuiltin = false;
    loaded.manifest = discovered.manifest;

    return loaded;
}

std::string PluginLoader::getLibraryFilename(const std::string& baseName) {
#ifdef _WIN32
    return baseName + ".dll";
#elif defined(__APPLE__)
    return baseName + ".dylib";
#else
    return baseName + ".so";
#endif
}

// =============================================================================
// Default Plugin Directory
// =============================================================================

std::filesystem::path getDefaultPluginDirectory() {
#ifdef _WIN32
    const char* appdata = std::getenv("APPDATA");
    if (appdata) {
        return std::filesystem::path(appdata) / "StratCraft" / "plugins";
    }
    return std::filesystem::path("C:/Users") / "StratCraft" / "plugins";
#elif defined(__APPLE__)
    const char* home = std::getenv("HOME");
    if (home) {
        return std::filesystem::path(home) / "Library" / "Application Support" / "StratCraft" / "plugins";
    }
    return std::filesystem::path("/tmp") / "StratCraft" / "plugins";
#else
    const char* home = std::getenv("HOME");
    if (home) {
        return std::filesystem::path(home) / ".StratCraft" / "plugins";
    }
    return std::filesystem::path("/tmp") / "StratCraft" / "plugins";
#endif
}

} // namespace StratCraft::executor
