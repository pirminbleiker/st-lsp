PROGRAM TestProg
VAR
    flag : BOOL;
    count : INT;
    timer : TON;
END_VAR

IF flag THEN
    count := count + 1;
    timer(IN := flag, PT := T#5S);
END_IF

END_PROGRAM
