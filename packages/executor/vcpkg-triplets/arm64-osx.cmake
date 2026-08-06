# TICKET_1330_1: Release-only dependency builds.
# Mirrors vcpkg's built-in arm64-osx triplet, adding VCPKG_BUILD_TYPE release.
# See x64-linux.cmake in this directory for the full rationale.
set(VCPKG_TARGET_ARCHITECTURE arm64)
set(VCPKG_CRT_LINKAGE dynamic)
set(VCPKG_LIBRARY_LINKAGE static)

set(VCPKG_CMAKE_SYSTEM_NAME Darwin)
set(VCPKG_OSX_ARCHITECTURES arm64)

set(VCPKG_BUILD_TYPE release)
