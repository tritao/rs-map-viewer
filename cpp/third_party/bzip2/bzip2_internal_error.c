#include <stdio.h>
#include <stdlib.h>

void bz_internal_error(int errcode) {
    fprintf(stderr, "bzip2 internal error: %d\n", errcode);
    abort();
}

