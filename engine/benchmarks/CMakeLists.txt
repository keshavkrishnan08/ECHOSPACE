add_executable(echospace_bench bench.cpp)
target_link_libraries(echospace_bench PRIVATE echospace_dsp echospace_warnings)

# Recorded in the JSON output so results can be traced to a configuration.
string(TOUPPER "${CMAKE_BUILD_TYPE}" _es_bt)
set(_es_flags "${CMAKE_CXX_FLAGS} ${CMAKE_CXX_FLAGS_${_es_bt}}")
if(ECHOSPACE_NATIVE_ARCH)
  string(APPEND _es_flags " -march=native")
endif()
string(STRIP "${_es_flags}" _es_flags)
target_compile_definitions(echospace_bench PRIVATE
  ECHOSPACE_BUILD_TYPE="${CMAKE_BUILD_TYPE}"
  ECHOSPACE_CXX_FLAGS="${_es_flags}")

if(ECHOSPACE_BUILD_TESTS)
  # Smoke test: every benchmark runs a few iterations without error.
  add_test(NAME bench.smoke COMMAND echospace_bench --iterations 3 --warmup 1)
endif()
