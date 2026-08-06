set(VCPKG_TARGET_ARCHITECTURE x64)
set(VCPKG_CRT_LINKAGE dynamic)
set(VCPKG_LIBRARY_LINKAGE static)
set(VCPKG_CMAKE_SYSTEM_NAME Linux)

set(VCPKG_CHAINLOAD_TOOLCHAIN_FILE "${CMAKE_CURRENT_LIST_DIR}/../cmake/clang18-libcxx-toolchain.cmake")
set(VCPKG_C_FLAGS "")
set(VCPKG_CXX_FLAGS "-stdlib=libc++")
set(VCPKG_LINKER_FLAGS "-stdlib=libc++")

# TICKET_1330_1: Release-only, consistent with the other triplets in this
# directory. Selected by setting VCPKG_DEFAULT_TRIPLET to this triplet's name
# when building the EXECUTOR_USE_LIBCXX=ON configuration (see
# packages/executor/CMakeLists.txt:19 and .github/workflows/cpp-build.yml).
set(VCPKG_BUILD_TYPE release)
