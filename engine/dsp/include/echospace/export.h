#ifndef ECHOSPACE_EXPORT_H
#define ECHOSPACE_EXPORT_H

#if defined(_WIN32)
#  if defined(ECHOSPACE_DSP_BUILDING)
#    define ES_API __declspec(dllexport)
#  else
#    define ES_API __declspec(dllimport)
#  endif
#else
#  define ES_API __attribute__((visibility("default")))
#endif

#endif
