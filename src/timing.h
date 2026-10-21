// --time support: stage timestamps printed to stderr.
#pragma once

#include <QElapsedTimer>

namespace mdw::timing {
void start();               // call first thing in main()
void setEnabled(bool on);
bool enabled();
void mark(const char *stage); // prints "<ms> stage" when enabled
qint64 elapsedMs();
}
