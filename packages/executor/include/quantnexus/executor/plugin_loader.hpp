/**
 * Plugin Loader
 *
 * TICKET_251_2: Dynamic plugin loading mechanism
 *
 * Manages plugin lifecycle:
 * - Discovers plugins from plugin directory
 * - Loads plugins dynamically (dlopen/LoadLibrary)
 * - Provides access to built-in plugins
 * - Handles plugin cleanup
 */

#pragma once

#include "plugin_interface.hpp"

#include <filesystem>
#include <unordered_map>
#include <vector>
#include <mutex>
#include <memory>

namespace StratCraft::executor {

// =============================================================================
// Plugin Manifest
// =============================================================================

/**
 * Plugin manifest structure (parsed from manifest.json)
 */
struct PluginManifest {
    std::string name;
    std::string version;
    std::string description;
    std::string libraryName;          // e.g., "libsample_plugin" (without extension)
    std::vector<std::string> dependencies;

    NLOHMANN_DEFINE_TYPE_INTRUSIVE_WITH_DEFAULT(PluginManifest,
        name, version, description, libraryName, dependencies)
};

// =============================================================================
// Plugin Loader
// =============================================================================

/**
 * Plugin loader singleton
 *
 * Thread-safe plugin management with support for both
 * built-in and dynamically loaded plugins.
 */
class PluginLoader {
public:
    /**
     * Get singleton instance
     */
    static PluginLoader& instance();

    // Non-copyable, non-movable
    PluginLoader(const PluginLoader&) = delete;
    PluginLoader& operator=(const PluginLoader&) = delete;
    PluginLoader(PluginLoader&&) = delete;
    PluginLoader& operator=(PluginLoader&&) = delete;

    // =========================================================================
    // Plugin Discovery
    // =========================================================================

    /**
     * Scan plugin directory for available plugins
     *
     * Looks for directories containing manifest.json files.
     * Does not load plugins, only discovers them.
     *
     * @param pluginDir Path to plugin directory (e.g., ~/.StratCraft/plugins/)
     */
    void scanPlugins(const std::filesystem::path& pluginDir);

    /**
     * List discovered plugin names
     *
     * @return Vector of plugin names (both built-in and discovered)
     */
    [[nodiscard]] std::vector<std::string> listPlugins() const;

    /**
     * Check if plugin is available
     *
     * @param name Plugin name
     * @return true if plugin exists (built-in or discovered)
     */
    [[nodiscard]] bool hasPlugin(std::string_view name) const;

    // =========================================================================
    // Plugin Loading
    // =========================================================================

    /**
     * Load plugin by name
     *
     * For built-in plugins, returns instance directly.
     * For dynamic plugins, loads shared library and creates instance.
     *
     * @param name Plugin name
     * @return Pointer to plugin instance, or nullptr if not found
     *
     * Note: Caller does NOT own the returned pointer.
     * Plugin lifecycle is managed by PluginLoader.
     */
    IExecutorPlugin* loadPlugin(std::string_view name);

    /**
     * Unload plugin by name
     *
     * For dynamic plugins, destroys instance and unloads library.
     * Built-in plugins cannot be unloaded.
     *
     * @param name Plugin name
     */
    void unloadPlugin(std::string_view name);

    /**
     * Unload all dynamic plugins
     */
    void unloadAll();

    // =========================================================================
    // Built-in Plugin Registration
    // =========================================================================

    /**
     * Register a built-in plugin
     *
     * Built-in plugins are created once and reused.
     * Called during initialization for core plugins (e.g., backtest).
     *
     * @param plugin Plugin instance (ownership transferred)
     */
    void registerBuiltinPlugin(std::unique_ptr<IExecutorPlugin> plugin);

    /**
     * Get built-in plugin by name
     *
     * @param name Plugin name
     * @return Pointer to plugin, or nullptr if not found
     */
    [[nodiscard]] IExecutorPlugin* getBuiltinPlugin(std::string_view name) const;

    // =========================================================================
    // Plugin Info
    // =========================================================================

    /**
     * Get plugin manifest
     *
     * @param name Plugin name
     * @return Manifest if available, nullopt otherwise
     */
    [[nodiscard]] std::optional<PluginManifest> getManifest(std::string_view name) const;

    /**
     * Check if plugin is loaded
     *
     * @param name Plugin name
     * @return true if plugin is currently loaded
     */
    [[nodiscard]] bool isLoaded(std::string_view name) const;

private:
    PluginLoader() = default;
    ~PluginLoader();

    // =========================================================================
    // Internal Types
    // =========================================================================

    struct LoadedPlugin {
        void* handle = nullptr;               // dlopen handle (nullptr for built-in)
        IExecutorPlugin* instance = nullptr;
        DestroyPluginFunc destroy = nullptr;
        bool isBuiltin = false;
        PluginManifest manifest;
    };

    struct DiscoveredPlugin {
        std::filesystem::path directory;
        PluginManifest manifest;
    };

    // =========================================================================
    // Internal Methods
    // =========================================================================

    /**
     * Load shared library and create plugin instance
     */
    LoadedPlugin loadDynamicPlugin(const DiscoveredPlugin& discovered);

    /**
     * Get platform-specific library filename
     */
    static std::string getLibraryFilename(const std::string& baseName);

    // =========================================================================
    // Data Members
    // =========================================================================

    mutable std::mutex mutex_;

    // Built-in plugins (owned)
    std::unordered_map<std::string, std::unique_ptr<IExecutorPlugin>> builtinPlugins_;

    // Discovered plugins (not yet loaded)
    std::unordered_map<std::string, DiscoveredPlugin> discoveredPlugins_;

    // Loaded dynamic plugins
    std::unordered_map<std::string, LoadedPlugin> loadedPlugins_;
};

// =============================================================================
// Default Plugin Directory
// =============================================================================

/**
 * Get default plugin directory path
 *
 * Platform-specific:
 * - Linux: ~/.StratCraft/plugins/
 * - macOS: ~/Library/Application Support/StratCraft/plugins/
 * - Windows: %APPDATA%/StratCraft/plugins/
 */
[[nodiscard]] std::filesystem::path getDefaultPluginDirectory();

} // namespace StratCraft::executor
