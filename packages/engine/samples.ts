/**
 * Built-in sample warriors, verbatim from spec/guide.md section 12 (plus the
 * recommended imp and the warriors-page Dwarf parser fixture).
 *
 * OWNER: architect. FROZEN after the scaffold phase.
 */

export const DWARF = `;name dwarf
start   add.ab  #4, bmb
        mov.i   bmb, @bmb
        jmp     start
bmb     dat     #0, #0
`;

export const STONE = `;name stone
start mov.i <2, 3
      add.f d1, start
      jmp   start
      dat   #0
d1    dat   #-4, #4
end start
`;

export const MICE = `;name mice
mov.ab  #12, -1
mov.i   @-2, <5
djn     -1, -3
spl     @3, 0
add.ab  #653, 2
jmz     -5, -6
dat     #0, #833
`;

export const SILK = `;name silk
      spl     1
      mov     -1,       0
      spl     1

paper spl     @paper,   2364
      mov.i   }paper,   >paper
      mov.i   bmb,      >paper
      mov.i   bmb,      {-61
      mov.i   bmb,      {4000
silk  jmp     @0,       {paper
bmb   dat.f   <2667,    <2*2667
`;

/** No ;name in the docs; the file name is scanner.red. */
export const SCANNER = `scn add   #10, ptr
ptr jmz.f scn, 5
    mov.i 2, >ptr
    jmp   -1
`;

/** Not verbatim from the docs (recommended in guide.md 12.4). */
export const IMP = `;name imp
mov 0, 1
`;

/** Parser fixture: the unlabeled Dwarf from the warriors page; assembles like DWARF. */
export const DWARF_UNLABELED = `add #4, 3
mov 2, @2
jmp -2
dat #0, #0
`;

/** Samples keyed by file name. */
export const SAMPLES: Readonly<Record<string, string>> = Object.freeze({
    'dwarf.red': DWARF,
    'stone.red': STONE,
    'mice.red': MICE,
    'silk.red': SILK,
    'scanner.red': SCANNER,
    'imp.red': IMP,
});

/** The default benchmark set (guide.md 11): every sample above. */
export const DEFAULT_BENCHMARK_SOURCES: readonly string[] = [DWARF, STONE, MICE, SILK, SCANNER, IMP];
