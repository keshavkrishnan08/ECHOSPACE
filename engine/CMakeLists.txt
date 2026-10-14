cmake_minimum_required(VERSION 3.20)

project(echospace_engine
        VERSION 0.1.0
        DESCRIPTION "ECHOSPACE native DSP engine"
        LANGUAGES CXX)

option(ECHOSPACE_ENABLE_CUDA "Build the optional CUDA kernels (requires the CUDA toolkit)" OFF)
option(ECHOSPACE_BUILD_TESTS "Build C++ unit tests" ON)
option(ECHOSPACE_BUILD_BENCHMARKS "Build echospace_bench" ON)
option(ECHOSPACE_WERROR "Treat compiler warnings as errors" OFF)
option(ECHOSPACE_NATIVE_ARCH "Compile with -march=native (results are not portable)" OFF)
set(ECHOSPACE_SANITIZE "" CACHE STRING "Sanitizer to enable for all targets: thread, address, undefined, or empty")

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Keep artefacts in predictable places; the Python bindings look in <build>/lib.
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)

add_library(echospace_warnings INTERFACE)
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(echospace_warnings INTERFACE
    $<$<COMPILE_LANGUAGE:CXX>:-Wall -Wextra -Wpedantic -Wshadow>)
  if(ECHOSPACE_WERROR)
    target_compile_options(echospace_warnings INTERFACE $<$<COMPILE_LANGUAGE:CXX>:-Werror>)
  endif()
  if(ECHOSPACE_NATIVE_ARCH)
    target_compile_options(echospace_warnings INTERFACE $<$<COMPILE_LANGUAGE:CXX>:-march=native>)
  endif()
  if(ECHOSPACE_SANITIZE)
    target_compile_options(echospace_warnings INTERFACE
      $<$<COMPILE_LANGUAGE:CXX>:-fsanitize=${ECHOSPACE_SANITIZE} -fno-omit-frame-pointer>)
    target_link_options(echospace_warnings INTERFACE -fsanitize=${ECHOSPACE_SANITIZE})
  endif()
elseif(MSVC)
  target_compile_options(echospace_warnings INTERFACE /W4 $<$<BOOL:${ECHOSPACE_WERROR}>:/WX>)
endif()

if(ECHOSPACE_BUILD_TESTS)
  enable_testing()
endif()

add_subdirectory(dsp)

if(ECHOSPACE_BUILD_BENCHMARKS)
  add_subdirectory(benchmarks)
endif()

if(ECHOSPACE_ENABLE_CUDA)
  add_subdirectory(cuda)
else()
  message(STATUS "echospace: CUDA kernels disabled (ECHOSPACE_ENABLE_CUDA=OFF); CPU path only")
endif()
