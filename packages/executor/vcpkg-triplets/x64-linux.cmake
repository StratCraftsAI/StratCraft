# TICKET_1330_1: Release-only dependency builds.
#
# Mirrors vcpkg's built-in x64-linux triplet, adding VCPKG_BUILD_TYPE release.
# vcpkg's default is to build every port TWICE (Debug + Release). Nothing in
# this project ever links the Debug half -- packages/executor/build.sh and
# .github/workflows/benchmark.yml both configure CMAKE_BUILD_TYPE=Release -- yet
# it cost 4.1 GB of the 4.6 GB vcpkg_installed tree (libonnxruntime_providers.a
# alone is 1.4 GB in Debug vs 45 MB in Release) and roughly half the dependency
# compile time. On GitHub-hosted runners (~14 GB usable) that exhausted the disk
# and killed `start.sh build` after 88 minutes with:
#   Fatal error: can't write ... to section .debug_info: 'No space left on device'
#
# This overlay shadows the built-in triplet of the same name, so
# VCPKG_DEFAULT_TRIPLET / matrix triplet values stay unchanged.
set(VCPKG_TARGET_ARCHITECTURE x64)
set(VCPKG_CRT_LINKAGE dynamic)
set(VCPKG_LIBRARY_LINKAGE static)

set(VCPKG_CMAKE_SYSTEM_NAME Linux)

set(VCPKG_BUILD_TYPE release)
