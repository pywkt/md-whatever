# The web reader: one self-contained HTML page (build/web/md-whatever.html) with
# md-whatever's Markdown engine compiled to WebAssembly, plus a JavaScript
# translation of it for browsers that block wasm; and build/web/site/, the same
# page with a manifest, service worker and icons for GitHub Pages. Published
# (Pages, Releases; see .github/workflows/web.yml), never committed.
#
#   -DMDW_WEB_READER=AUTO  build it if the tools below are installed (default)
#                    ON    the same, but stop with an error if they aren't
#                    OFF   don't build it
#
# Tools (Arch): clang lld wasi-libc wasi-libc++ wasi-libc++abi wasi-compiler-rt
# binaryen python, and nodejs for the tests.

set(MDW_WEB_READER AUTO CACHE STRING "Build the web reader: AUTO, ON or OFF")
set_property(CACHE MDW_WEB_READER PROPERTY STRINGS AUTO ON OFF)
set(MDW_WASI_SYSROOT /usr/share/wasi-sysroot CACHE PATH "WASI sysroot (wasi-libc, libc++)")

# Node runs the helper tests even without the rest.
find_program(MDW_NODE node)
if(MDW_NODE)
  add_test(NAME web-lib COMMAND ${MDW_NODE} --test ${CMAKE_SOURCE_DIR}/tests/web/lib.test.cjs)
endif()

string(TOUPPER "${MDW_WEB_READER}" _mode)
if(NOT _mode MATCHES "^(AUTO|ON|OFF)$")
  message(FATAL_ERROR "MDW_WEB_READER must be AUTO, ON or OFF, not ${MDW_WEB_READER}")
endif()
if(_mode STREQUAL OFF)
  return()
endif()

# Stops (ON) or explains and skips the web reader (AUTO). A macro, so its
# return() leaves this file.
macro(mdw_web_unavailable why)
  if(_mode STREQUAL ON)
    message(FATAL_ERROR "Web reader: ${why}")
  endif()
  message(STATUS "Web reader: not built, ${why} (-DMDW_WEB_READER=OFF silences this)")
  return()
endmacro()

# --- tools ------------------------------------------------------------------
find_program(MDW_WASM_CLANG clang)
find_program(MDW_WASM_CLANGXX clang++)
find_program(MDW_WASM_OPT wasm-opt)
find_program(MDW_WASM2JS wasm2js)
find_package(Python3 3.8 COMPONENTS Interpreter)
foreach(tool MDW_WASM_CLANG MDW_WASM_CLANGXX MDW_WASM_OPT MDW_WASM2JS)
  if(NOT ${tool})
    mdw_web_unavailable("${tool} not found (clang, binaryen)")
  endif()
endforeach()
if(NOT Python3_Interpreter_FOUND)
  mdw_web_unavailable("python3 not found")
endif()

set(MDW_WASM_FLAGS --target=wasm32-wasip1 --sysroot=${MDW_WASI_SYSROOT})

# A C++ program with libc++ that links as a wasm reactor proves the whole
# toolchain (target, sysroot, libc++, compiler-rt, wasm-ld) is there.
set(_probe ${CMAKE_CURRENT_BINARY_DIR}/probe)
file(MAKE_DIRECTORY ${_probe})
file(WRITE ${_probe}/probe.cpp
  "#include <string>\nextern \"C\" __attribute__((export_name(\"f\"))) int f(int n) { return int(std::to_string(n).size()); }\n")
execute_process(
  COMMAND ${MDW_WASM_CLANGXX} ${MDW_WASM_FLAGS} -std=c++20 -O2 -fno-exceptions -mexec-model=reactor
          ${_probe}/probe.cpp -o ${_probe}/probe.wasm
  RESULT_VARIABLE _rc OUTPUT_VARIABLE _out ERROR_VARIABLE _out)
if(NOT _rc EQUAL 0)
  string(REGEX REPLACE "\n.*" "" _out "${_out}")
  mdw_web_unavailable("clang++ cannot build WebAssembly with ${MDW_WASI_SYSROOT} (${_out}); install lld wasi-libc wasi-libc++ wasi-libc++abi wasi-compiler-rt")
endif()

# --- md4c source, pinned --------------------------------------------------------
# The desktop app uses the system md4c; the web engine (and engine_native, the
# native build it's compared with) use this exact release.
set(MD4C_WEB_VERSION 0.6.0)
set(_md4c_tgz ${CMAKE_BINARY_DIR}/downloads/md4c-${MD4C_WEB_VERSION}.tar.gz)
set(MD4C_WEB_DIR ${CMAKE_BINARY_DIR}/downloads/md4c-${MD4C_WEB_VERSION})
if(NOT EXISTS ${MD4C_WEB_DIR}/src/md4c.c)
  if(NOT EXISTS ${_md4c_tgz})
    message(STATUS "Downloading md4c ${MD4C_WEB_VERSION} for the web reader")
    file(DOWNLOAD https://github.com/mity/md4c/archive/refs/tags/v${MD4C_WEB_VERSION}.tar.gz
      ${_md4c_tgz}.part
      EXPECTED_HASH SHA256=4d151298125a81da3b2efa2e0eed8bdb7a9318569804e4fa4d7a2375ab83ef70
      TLS_VERIFY ON STATUS _st)
    list(GET _st 0 _code)
    if(NOT _code EQUAL 0)
      file(REMOVE ${_md4c_tgz}.part)
      list(GET _st 1 _msg)
      mdw_web_unavailable("downloading md4c failed (${_msg})")
    endif()
    file(RENAME ${_md4c_tgz}.part ${_md4c_tgz})
  endif()
  set(_x ${CMAKE_BINARY_DIR}/downloads/md4c-extract)
  file(REMOVE_RECURSE ${_x})
  file(ARCHIVE_EXTRACT INPUT ${_md4c_tgz} DESTINATION ${_x}
       PATTERNS md4c-${MD4C_WEB_VERSION}/src/md4c.c md4c-${MD4C_WEB_VERSION}/src/md4c.h
                md4c-${MD4C_WEB_VERSION}/LICENSE.md)
  file(GLOB _top LIST_DIRECTORIES true ${_x}/*)
  file(REMOVE_RECURSE ${MD4C_WEB_DIR})
  file(RENAME ${_top} ${MD4C_WEB_DIR})
  file(REMOVE_RECURSE ${_x})
endif()
set(_md4c_src ${MD4C_WEB_DIR}/src)

# --- the engine, natively (for the tests) ---------------------------------------
enable_language(C)
add_executable(engine_native ${CMAKE_SOURCE_DIR}/tests/web/engine_native.cpp
  engine.cpp ${CMAKE_SOURCE_DIR}/src/markdown.cpp ${_md4c_src}/md4c.c)
target_include_directories(engine_native PRIVATE ${_md4c_src} ${CMAKE_SOURCE_DIR}/src ${CMAKE_CURRENT_SOURCE_DIR})
set_target_properties(engine_native PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
  AUTOMOC OFF AUTORCC OFF) # no Qt here

# --- the engine, as WebAssembly and JavaScript --------------------------------------
# Clang tags its output with every feature it may use; wasm-opt then validates
# the module against the set we allow, so a new instruction kind fails the
# build instead of failing in an older browser. This set (bulk memory and
# saturating float-to-int being the newest) is in Safari 15, Chrome 75 and
# Firefox 79; anything older uses the JavaScript fallback.
set(_features --mvp-features --enable-mutable-globals --enable-sign-ext --enable-bulk-memory
  --enable-bulk-memory-opt --enable-nontrapping-float-to-int)
set(_o ${CMAKE_CURRENT_BINARY_DIR})
set(_cxx ${MDW_WASM_CLANGXX} ${MDW_WASM_FLAGS} -std=c++20 -O2 -fno-exceptions
  -I${_md4c_src} -I${CMAKE_SOURCE_DIR}/src -I${CMAKE_CURRENT_SOURCE_DIR})

add_custom_command(OUTPUT ${_o}/md4c.wasm.o
  COMMAND ${MDW_WASM_CLANG} ${MDW_WASM_FLAGS} -O2 -c ${_md4c_src}/md4c.c -o ${_o}/md4c.wasm.o
  DEPENDS ${_md4c_src}/md4c.c ${_md4c_src}/md4c.h VERBATIM)
add_custom_command(OUTPUT ${_o}/markdown.wasm.o
  COMMAND ${_cxx} -c ${CMAKE_SOURCE_DIR}/src/markdown.cpp -o ${_o}/markdown.wasm.o
  DEPENDS ${CMAKE_SOURCE_DIR}/src/markdown.cpp ${CMAKE_SOURCE_DIR}/src/markdown.h ${_md4c_src}/md4c.h VERBATIM)
add_custom_command(OUTPUT ${_o}/engine.wasm.o
  COMMAND ${_cxx} -c ${CMAKE_CURRENT_SOURCE_DIR}/engine.cpp -o ${_o}/engine.wasm.o
  DEPENDS engine.cpp engine.h ${CMAKE_SOURCE_DIR}/src/markdown.h VERBATIM)
add_custom_command(OUTPUT ${_o}/engine.wasm
  COMMAND ${MDW_WASM_CLANGXX} ${MDW_WASM_FLAGS} -mexec-model=reactor -Wl,--strip-debug
          ${_o}/md4c.wasm.o ${_o}/markdown.wasm.o ${_o}/engine.wasm.o -o ${_o}/engine.linked.wasm
  COMMAND ${MDW_WASM_OPT} --strip-target-features ${_o}/engine.linked.wasm -o ${_o}/engine.untagged.wasm
  COMMAND ${MDW_WASM_OPT} ${_features} -O2 --strip-debug --strip-producers
          ${_o}/engine.untagged.wasm -o ${_o}/engine.wasm
  DEPENDS ${_o}/md4c.wasm.o ${_o}/markdown.wasm.o ${_o}/engine.wasm.o
  COMMENT "Linking the web reader's engine (WebAssembly)" VERBATIM)
add_custom_command(OUTPUT ${_o}/engine.wasm2js.mjs
  COMMAND ${MDW_WASM2JS} ${_features} -O2 ${_o}/engine.wasm -o ${_o}/engine.wasm2js.mjs
  DEPENDS ${_o}/engine.wasm
  COMMENT "Translating the engine to JavaScript (wasm2js)" VERBATIM)

# --- the page --------------------------------------------------------------------
# Everything web/build.py reads, so the page is rebuilt when any of it changes.
file(GLOB _example_themes CONFIGURE_DEPENDS ${CMAKE_SOURCE_DIR}/examples/themes/*.css)
set(_icons icon.svg icon-192.png icon-512.png maskable-512.png apple-touch-icon.png)
list(TRANSFORM _icons PREPEND icons/ OUTPUT_VARIABLE _icon_inputs)
set(_page_inputs build.py reader.html reader.css reader.js lib.js viewer.css samples/welcome.md
  manifest.webmanifest sw.js ${_icon_inputs}
  ${CMAKE_SOURCE_DIR}/src/themes/base.css ${CMAKE_SOURCE_DIR}/src/themes/default.css
  ${CMAKE_SOURCE_DIR}/src/themes/paper.css ${_example_themes}
  ${CMAKE_SOURCE_DIR}/tests/fixtures/kitchen-sink.md ${CMAKE_SOURCE_DIR}/tests/fixtures/math.md
  ${CMAKE_SOURCE_DIR}/README.md ${CMAKE_SOURCE_DIR}/tests/fixtures/images/diagram.svg
  ${CMAKE_SOURCE_DIR}/tests/fixtures/images/wide.png CMakeLists.txt)
list(TRANSFORM _icon_inputs PREPEND ${_o}/site/ OUTPUT_VARIABLE _site_icons)
set(_site ${_o}/site/index.html ${_o}/site/manifest.webmanifest ${_o}/site/sw.js ${_site_icons})
add_custom_command(OUTPUT ${_o}/md-whatever.html ${_o}/engine.asm.js ${_site}
  COMMAND Python3::Interpreter ${CMAKE_CURRENT_SOURCE_DIR}/build.py
          --wasm ${_o}/engine.wasm --asm ${_o}/engine.wasm2js.mjs
          --out ${_o}/md-whatever.html --site ${_o}/site --asm-out ${_o}/engine.asm.js
  DEPENDS ${_o}/engine.wasm ${_o}/engine.wasm2js.mjs ${_page_inputs}
  COMMENT "Assembling the web reader (md-whatever.html, site/)" VERBATIM)
add_custom_target(web-reader ALL DEPENDS ${_o}/md-whatever.html ${_o}/engine.asm.js ${_site})
message(STATUS "Web reader: building ${_o}/md-whatever.html")

# --- tests --------------------------------------------------------------------------
if(MDW_NODE)
  add_test(NAME web-engine COMMAND ${MDW_NODE} --test ${CMAKE_SOURCE_DIR}/tests/web/engine.test.cjs)
  set_tests_properties(web-engine PROPERTIES ENVIRONMENT
    "MDW_WEB_WASM=${_o}/engine.wasm;MDW_WEB_ASM=${_o}/engine.asm.js;MDW_ENGINE_NATIVE=$<TARGET_FILE:engine_native>")
  # Headless Chromium, network blocked; skipped (exit 77) without Chromium.
  foreach(engine wasm js)
    add_test(NAME web-smoke-${engine}
      COMMAND ${MDW_NODE} ${CMAKE_SOURCE_DIR}/tests/web/smoke.cjs ${_o}/md-whatever.html --engine=${engine})
    set_tests_properties(web-smoke-${engine} PROPERTIES SKIP_RETURN_CODE 77 TIMEOUT 60)
  endforeach()
  # The hosted version on a local server: install, offline, Recent, launches.
  add_test(NAME web-site COMMAND ${MDW_NODE} ${CMAKE_SOURCE_DIR}/tests/web/site.cjs ${_o}/site)
  set_tests_properties(web-site PROPERTIES SKIP_RETURN_CODE 77 TIMEOUT 90)
  # Editing: modes, saving in place byte for byte, conflicts, downloads.
  add_test(NAME web-edit COMMAND ${MDW_NODE} ${CMAKE_SOURCE_DIR}/tests/web/edit.cjs ${_o}/md-whatever.html)
  set_tests_properties(web-edit PROPERTIES SKIP_RETURN_CODE 77 TIMEOUT 90)
  # The formatting toolbar: Read-mode selections to source and back, undo, saving.
  add_test(NAME web-live COMMAND ${MDW_NODE} ${CMAKE_SOURCE_DIR}/tests/web/live.cjs ${_o}/md-whatever.html)
  set_tests_properties(web-live PROPERTIES SKIP_RETURN_CODE 77 TIMEOUT 90)
endif()
