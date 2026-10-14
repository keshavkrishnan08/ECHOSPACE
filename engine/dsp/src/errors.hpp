#pragma once

#include <stdexcept>

namespace echospace::dsp::detail {

// Thrown for FFT lengths that are not a power of two; maps to ES_ERR_NOT_POW2 in the C ABI.
struct NotPow2Error : std::invalid_argument {
    using std::invalid_argument::invalid_argument;
};

}  // namespace echospace::dsp::detail
