#!/bin/sh
# Builds bin/vst3-snapshot from native/vst3snap + the needed parts of the VST3 SDK.
set -e
cd "$(dirname "$0")/.."
SDK=native/vst3sdk
[ -d "$SDK/pluginterfaces" ] || git clone --depth 1 --recursive --shallow-submodules https://github.com/steinbergmedia/vst3sdk.git "$SDK"
mkdir -p bin
H=$SDK/public.sdk/source/vst/hosting
SRC="native/vst3snap/main.mm
  $H/module.cpp $H/module_mac.mm $H/plugprovider.cpp $H/hostclasses.cpp
  $H/pluginterfacesupport.cpp $H/connectionproxy.cpp
  $SDK/public.sdk/source/vst/utility/stringconvert.cpp
  $SDK/public.sdk/source/vst/vstinitiids.cpp
  $SDK/public.sdk/source/common/commoniids.cpp $SDK/public.sdk/source/common/commonstringconvert.cpp $SDK/public.sdk/source/common/threadchecker_mac.mm
  $SDK/pluginterfaces/base/funknown.cpp $SDK/pluginterfaces/base/coreiids.cpp
  $SDK/pluginterfaces/base/ustring.cpp $SDK/pluginterfaces/base/conststringtable.cpp
  $SDK/base/source/fobject.cpp $SDK/base/source/fstring.cpp $SDK/base/source/fdebug.cpp
  $SDK/base/source/updatehandler.cpp $SDK/base/source/baseiids.cpp
  $SDK/base/thread/source/flock.cpp"
ARCH=""
[ "$UNIVERSAL" = "1" ] && ARCH="-arch arm64 -arch x86_64"
clang++ -std=c++17 -O2 -fobjc-arc -mmacosx-version-min=13.0 $ARCH -DRELEASE=1 -I"$SDK" $SRC \
  -framework AppKit -framework CoreFoundation -framework CoreGraphics \
  -o bin/vst3-snapshot
echo "built bin/vst3-snapshot"
