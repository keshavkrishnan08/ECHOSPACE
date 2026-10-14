# Optional CUDA kernels. Configured only with -DECHOSPACE_ENABLE_CUDA=ON.
# UNVERIFIED in this repository (no CUDA toolchain or GPU was available); see README.md.
cmake_minimum_required(VERSION 3.20)

find_package(CUDAToolkit 12.0 REQUIRED)  # C++20 host code in .cu files needs nvcc >= 12
enable_language(CUDA)

if(NOT DEFINED CMAKE_CUDA_ARCHITECTURES)
  set(CMAKE_CUDA_ARCHITECTURES 70 80 86 90)
endif()

add_library(echospace_dsp_cuda SHARED
  src/recon_kernels.cu
  src/doppler_cufft.cu)
target_include_directories(echospace_dsp_cuda
  PUBLIC  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_compile_definitions(echospace_dsp_cuda PRIVATE ECHOSPACE_DSP_BUILDING)
set_target_properties(echospace_dsp_cuda PROPERTIES
  CUDA_STANDARD 20
  CUDA_STANDARD_REQUIRED ON
  CUDA_SEPARABLE_COMPILATION OFF)
# The CPU library provides the shared status codes, hann() and the reference used by tests.
target_link_libraries(echospace_dsp_cuda
  PUBLIC  echospace_dsp
  PRIVATE CUDA::cudart CUDA::cufft)
target_compile_options(echospace_dsp_cuda PRIVATE
  $<$<COMPILE_LANGUAGE:CUDA>:-Xcompiler=-Wall,-Wextra>)

if(ECHOSPACE_BUILD_TESTS)
  add_executable(test_cuda_vs_cpu tests/test_cuda_vs_cpu.cpp)
  target_include_directories(test_cuda_vs_cpu PRIVATE ${CMAKE_SOURCE_DIR}/dsp/tests)
  target_link_libraries(test_cuda_vs_cpu PRIVATE echospace_dsp_cuda echospace_dsp echospace_warnings)
  add_test(NAME cuda.vs_cpu COMMAND test_cuda_vs_cpu)
  # Exit code 77 = no CUDA device visible; reported as skipped rather than passed.
  set_tests_properties(cuda.vs_cpu PROPERTIES SKIP_RETURN_CODE 77)
endif()
