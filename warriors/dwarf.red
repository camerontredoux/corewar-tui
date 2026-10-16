;redcode-94
;assert 1
;name Dwarf
loop    mov     bomb, >bomb
        djn     loop, #4
        jmp     0
bomb    dat     #0, #1
        end
