# Windows build of the VST3 snapshot host (macOS uses native/build-vst3.sh).
cmake_minimum_required(VERSION 3.20)
project(vst3snap CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# Static runtime: the exe runs without a Visual C++ redistributable.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

set(SDK ${CMAKE_CURRENT_SOURCE_DIR}/../vst3sdk)
set(H ${SDK}/public.sdk/source/vst/hosting)

add_executable(vst3-snapshot
  main_win.cpp
  ${H}/module.cpp ${H}/module_win32.cpp ${H}/plugprovider.cpp ${H}/hostclasses.cpp
  ${H}/pluginterfacesupport.cpp ${H}/connectionproxy.cpp
  ${SDK}/public.sdk/source/vst/utility/stringconvert.cpp
  ${SDK}/public.sdk/source/vst/vstinitiids.cpp
  ${SDK}/public.sdk/source/common/commoniids.cpp
  ${SDK}/public.sdk/source/common/commonstringconvert.cpp
  ${SDK}/public.sdk/source/common/threadchecker_win32.cpp
  ${SDK}/pluginterfaces/base/funknown.cpp ${SDK}/pluginterfaces/base/coreiids.cpp
  ${SDK}/pluginterfaces/base/ustring.cpp ${SDK}/pluginterfaces/base/conststringtable.cpp
  ${SDK}/base/source/fobject.cpp ${SDK}/base/source/fstring.cpp ${SDK}/base/source/fdebug.cpp
  ${SDK}/base/source/updatehandler.cpp ${SDK}/base/source/baseiids.cpp
  ${SDK}/base/thread/source/flock.cpp
)
target_include_directories(vst3-snapshot PRIVATE ${SDK})
target_compile_definitions(vst3-snapshot PRIVATE RELEASE=1 UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
target_compile_options(vst3-snapshot PRIVATE /utf-8 /W1)
target_link_libraries(vst3-snapshot PRIVATE windowscodecs ole32 shell32 user32 gdi32)
