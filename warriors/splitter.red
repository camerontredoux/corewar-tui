;redcode-94
;name Splitter
;author
;strategy A dwarf: bomb every 4th address, forever.

spl 1
add #4, 3
spl 1
mov 2, @2
jmp -2
dat #0, #0
end
