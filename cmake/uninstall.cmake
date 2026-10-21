# Removes every file listed in install_manifest.txt (written by cmake --install).
set(manifest "${CMAKE_BINARY_DIR}/install_manifest.txt")
if(NOT EXISTS "${manifest}")
  message(FATAL_ERROR "Nothing to uninstall: ${manifest} not found (run cmake --install first).")
endif()
file(STRINGS "${manifest}" files)
foreach(f IN LISTS files)
  if(EXISTS "${f}" OR IS_SYMLINK "${f}")
    message(STATUS "Removing ${f}")
    file(REMOVE "${f}")
  endif()
endforeach()
# Remove now-empty data directories.
file(REMOVE_RECURSE "${MDREAD_DATA_DIR}")
