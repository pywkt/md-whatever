#include "timing.h"

#include <cstdio>

namespace mdread::timing {
namespace {
QElapsedTimer g_timer;
bool g_enabled = false;
}

void start() { g_timer.start(); }
void setEnabled(bool on) { g_enabled = on; }
bool enabled() { return g_enabled; }
qint64 elapsedMs() { return g_timer.elapsed(); }

void mark(const char *stage)
{
    if (g_enabled)
        std::fprintf(stderr, "[time] %7.1f ms  %s\n", g_timer.nsecsElapsed() / 1e6, stage);
}
}
