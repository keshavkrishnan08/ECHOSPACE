add_library(echospace_dsp SHARED
  src/fft.cpp
  src/preprocess.cpp
  src/recon.cpp
  src/c_api.cpp)

target_include_directories(echospace_dsp
  PUBLIC  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_compile_definitions(echospace_dsp PRIVATE ECHOSPACE_DSP_BUILDING)
target_link_libraries(echospace_dsp PRIVATE echospace_warnings)
set_target_properties(echospace_dsp PROPERTIES
  VERSION ${PROJECT_VERSION}
  SOVERSION ${PROJECT_VERSION_MAJOR})

# Header-only data-plane primitives (SpscRing).
add_library(echospace_dataplane INTERFACE)
target_include_directories(echospace_dataplane INTERFACE
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>)

if(ECHOSPACE_BUILD_TESTS)
  find_package(Threads REQUIRED)

  add_executable(test_dsp tests/test_dsp.cpp)
  target_link_libraries(test_dsp PRIVATE echospace_dsp echospace_warnings)
  add_test(NAME dsp.kernels COMMAND test_dsp)

  add_executable(test_spsc_ring tests/test_spsc_ring.cpp)
  target_link_libraries(test_spsc_ring PRIVATE echospace_dataplane echospace_warnings Threads::Threads)
  add_test(NAME dsp.spsc_ring COMMAND test_spsc_ring)
  set_tests_properties(dsp.spsc_ring PROPERTIES TIMEOUT 120)
endif()
