cmake_minimum_required(VERSION 3.21)
project(md-whatever VERSION 0.4.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

include(GNUInstallDirs)

# -DMDW_DESKTOP=OFF builds only the web reader (web/), without Qt; CI uses it.
option(MDW_DESKTOP "Build the desktop app (needs Qt 6)" ON)
if(NOT MDW_DESKTOP)
  enable_testing()
  add_subdirectory(web)
  return()
endif()

find_package(Qt6 6.5 REQUIRED COMPONENTS Core Gui Widgets Svg Test)
find_package(KF6SyntaxHighlighting REQUIRED)
find_package(md4c REQUIRED)

# The binary goes in build/bin so data can be found at ../share/md-whatever,
# the same layout as after installing.
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
set(MDW_DATA_BUILD_DIR ${CMAKE_BINARY_DIR}/share/md-whatever)

# --- qlitehtml (vendored), built against the system litehtml ---------------
set(QLITEHTML_USE_SYSTEM_LITEHTML ON)
set(QLITEHTML_LIBRARY_TYPE STATIC)
add_subdirectory(third_party/qlitehtml EXCLUDE_FROM_ALL)

# --- MathJax font data -------------------------------------------------------
# Arch's mathjax package lacks the font's "dynamic" ranges (\mathbb, \mathfrak,
# ...). Fetch them once at configure time, verify the hash, keep only svg/dynamic.
set(MATHJAX_FONT_VERSION 4.1.3)
set(MATHJAX_FONT_TGZ ${CMAKE_BINARY_DIR}/downloads/mathjax-newcm-font-${MATHJAX_FONT_VERSION}.tgz)
set(MATHJAX_FONT_DIR ${MDW_DATA_BUILD_DIR}/mathjax-newcm-font)
if(NOT EXISTS ${MATHJAX_FONT_DIR}/svg/dynamic)
  if(NOT EXISTS ${MATHJAX_FONT_TGZ})
    message(STATUS "Downloading @mathjax/mathjax-newcm-font ${MATHJAX_FONT_VERSION}")
    file(DOWNLOAD
      https://registry.npmjs.org/@mathjax/mathjax-newcm-font/-/mathjax-newcm-font-${MATHJAX_FONT_VERSION}.tgz
      ${MATHJAX_FONT_TGZ}
      EXPECTED_HASH SHA256=87d7b869c6a2a6169d9a53acc4eab6c846a9cbe11752738226461bb5070c8b88
      TLS_VERIFY ON)
  endif()
  set(_x ${CMAKE_BINARY_DIR}/downloads/font-extract)
  file(REMOVE_RECURSE ${_x})
  file(ARCHIVE_EXTRACT INPUT ${MATHJAX_FONT_TGZ} DESTINATION ${_x}
       PATTERNS "package/svg/dynamic/*" package/package.json) # Apache-2.0, per package.json
  file(MAKE_DIRECTORY ${MATHJAX_FONT_DIR})
  file(COPY ${_x}/package/svg ${_x}/package/package.json DESTINATION ${MATHJAX_FONT_DIR})
  file(REMOVE_RECURSE ${_x})
endif()

# Helper script that runs MathJax under node; copied next to the font data.
configure_file(data/mathjax-helper.cjs ${MDW_DATA_BUILD_DIR}/mathjax-helper.cjs COPYONLY)

# --- core library (everything except main) -----------------------------------
add_library(mdw_markdown STATIC src/markdown.cpp src/markdown.h)
target_include_directories(mdw_markdown PUBLIC src)
target_link_libraries(mdw_markdown PRIVATE md4c::md4c)

add_library(mdw_core STATIC
  src/highlight.cpp src/highlight.h
  src/math.cpp src/math.h
  src/theme.cpp src/theme.h
  src/document.cpp src/document.h
  src/viewer.cpp src/viewer.h
  src/mainwindow.cpp src/mainwindow.h
  src/findbar.cpp src/findbar.h
  src/noticebar.cpp src/noticebar.h
  src/editor.cpp src/editor.h
  src/timing.cpp src/timing.h
  src/resources.qrc)
target_include_directories(mdw_core PUBLIC src)
target_compile_definitions(mdw_core PRIVATE MDW_VERSION="${PROJECT_VERSION}")
target_link_libraries(mdw_core PUBLIC mdw_markdown qlitehtml Qt6::Widgets Qt6::Svg
  KF6::SyntaxHighlighting)

add_executable(md-whatever src/main.cpp)
target_compile_definitions(md-whatever PRIVATE MDW_VERSION="${PROJECT_VERSION}")
target_link_libraries(md-whatever PRIVATE mdw_core)

# --- tests --------------------------------------------------------------------
enable_testing()
add_executable(test_markdown tests/test_markdown.cpp)
target_link_libraries(test_markdown PRIVATE mdw_markdown Qt6::Test)
add_test(NAME markdown COMMAND test_markdown)
add_executable(test_editor tests/test_editor.cpp)
target_link_libraries(test_editor PRIVATE mdw_core Qt6::Test)
add_test(NAME editor COMMAND test_editor)
add_executable(test_viewer tests/test_viewer.cpp)
target_compile_definitions(test_viewer PRIVATE MDW_FIXTURES="${CMAKE_SOURCE_DIR}/tests/fixtures")
target_link_libraries(test_viewer PRIVATE mdw_core Qt6::Test)
add_test(NAME viewer COMMAND test_viewer)
set_tests_properties(viewer PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")

# --- web reader (optional; see web/CMakeLists.txt) ------------------------------
add_subdirectory(web)

# --- install -----------------------------------------------------------------
install(TARGETS md-whatever RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
# mdw: the short command, a link to md-whatever (listed in the manifest, so
# uninstall removes it too).
install(CODE "
  set(mdw_link \"\$ENV{DESTDIR}${CMAKE_INSTALL_FULL_BINDIR}/mdw\")
  message(STATUS \"Installing: \${mdw_link}\")
  file(CREATE_LINK md-whatever \"\${mdw_link}\" SYMBOLIC)
  list(APPEND CMAKE_INSTALL_MANIFEST_FILES \"${CMAKE_INSTALL_FULL_BINDIR}/mdw\")
")
install(DIRECTORY ${MDW_DATA_BUILD_DIR}/ DESTINATION ${CMAKE_INSTALL_DATADIR}/md-whatever)
# Full path in Exec so launching from Dolphin works even if ~/.local/bin
# isn't on the desktop session's PATH.
set(MDW_EXEC ${CMAKE_INSTALL_FULL_BINDIR}/md-whatever)
configure_file(data/md-whatever.desktop.in ${CMAKE_BINARY_DIR}/md-whatever.desktop @ONLY)
install(FILES ${CMAKE_BINARY_DIR}/md-whatever.desktop DESTINATION ${CMAKE_INSTALL_DATADIR}/applications)
install(CODE "execute_process(COMMAND update-desktop-database ${CMAKE_INSTALL_FULL_DATADIR}/applications)")

# Make md-whatever the default for Markdown (writes ~/.config/mimeapps.list).
add_custom_target(set-default
  COMMAND xdg-mime default md-whatever.desktop text/markdown
  COMMAND xdg-mime default md-whatever.desktop text/x-markdown
  COMMAND xdg-mime query default text/markdown
  COMMENT "Setting md-whatever as the default Markdown handler")
# Put Okular back as the default (what it was before md-whatever).
add_custom_target(restore-default
  COMMAND xdg-mime default org.kde.okular.desktop text/markdown
  COMMAND xdg-mime default org.kde.okular.desktop text/x-markdown
  COMMAND xdg-mime query default text/markdown
  COMMENT "Restoring Okular as the default Markdown handler")
add_custom_target(uninstall
  COMMAND ${CMAKE_COMMAND} -DCMAKE_BINARY_DIR=${CMAKE_BINARY_DIR}
          -DMDW_DATA_DIR=${CMAKE_INSTALL_FULL_DATADIR}/md-whatever -P ${CMAKE_SOURCE_DIR}/cmake/uninstall.cmake
  COMMAND update-desktop-database ${CMAKE_INSTALL_FULL_DATADIR}/applications
  COMMENT "Removing installed files listed in install_manifest.txt")
