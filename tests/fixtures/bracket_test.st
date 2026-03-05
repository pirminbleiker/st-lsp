(* Test file for bracket highlighting in strings *)
PROGRAM BracketTest
VAR
    msg : STRING := 'ARRAY [0..10] of INT';
    desc : STRING := "Indexed access [index]";
    arr : ARRAY [0..10] OF INT;
    value : INT;
END_VAR

(* Brackets in comments should be ignored [like this] *)
// And in line comments too [this should work]

value := arr[5];  (* Brackets outside strings should highlight *)

(* String with escaped quote '' and brackets [] *)
msg := 'Test ''string'' with [brackets]';

END_PROGRAM
