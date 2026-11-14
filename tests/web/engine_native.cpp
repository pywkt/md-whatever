// The web reader's engine (web/engine.cpp) built natively, for tests/web.
//   engine_native render FILE   prints the HTML the page would get for FILE
//   engine_native slug TEXT     prints the anchor slug for TEXT
#include "engine.h"

#include <cstdio>
#include <cstring>
#include <fstream>
#include <iostream>
#include <iterator>

int main(int argc, char **argv)
{
    if (argc == 3 && std::strcmp(argv[1], "render") == 0) {
        std::ifstream in(argv[2], std::ios::binary);
        if (!in) {
            std::fprintf(stderr, "engine_native: cannot read %s\n", argv[2]);
            return 1;
        }
        const std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
        std::cout << mdw::web::render(text);
        return 0;
    }
    if (argc == 3 && std::strcmp(argv[1], "slug") == 0) {
        std::cout << mdw::web::slug(argv[2]);
        return 0;
    }
    std::fputs("usage: engine_native render FILE | slug TEXT\n", stderr);
    return 2;
}
