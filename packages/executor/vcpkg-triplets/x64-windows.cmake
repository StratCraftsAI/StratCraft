# TICKET_1330_1: Release-only dependency builds.
# Mirrors vcpkg's built-in x64-windows triplet, adding VCPKG_BUILD_TYPE release.
# See x64-linux.cmake in this directory for the full rationale.
set(VCPKG_TARGET_ARCHITECTURE x64)
set(VCPKG_CRT_LINKAGE dynamic)
set(VCPKG_LIBRARY_LINKAGE dynamic)

set(VCPKG_BUILD_TYPE release)
