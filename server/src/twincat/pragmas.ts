/** TwinCAT pragma/attribute documentation database */

export interface PragmaDoc {
  name: string;
  summary: string;
  description: string;
  example?: string;
}

const PRAGMA_DOCS: PragmaDoc[] = [
  {
    name: 'monitoring',
    summary: 'Control online variable monitoring in the watch window.',
    description:
      'Specifies how a variable is displayed in the online monitoring window. ' +
      '`call` forces the variable to be evaluated on every cycle (useful for FB outputs that are not refreshed otherwise).',
    example: "{attribute 'monitoring' := 'call'}",
  },
  {
    name: 'hide',
    summary: 'Hide variable or POU from IntelliSense / auto-complete.',
    description:
      'Prevents the variable or function block from appearing in IntelliSense suggestions. ' +
      'Useful for internal implementation details that consumers should not use directly.',
    example: "{attribute 'hide'}",
  },
  {
    name: 'obsolete',
    summary: 'Mark a symbol as deprecated with a replacement hint.',
    description:
      'Marks a variable, POU, or method as obsolete. The compiler will emit a warning whenever ' +
      'the symbol is referenced. The attribute value is shown as the warning message and should ' +
      'describe what to use instead.',
    example: "{attribute 'obsolete' := 'Use NewFunc instead'}",
  },
  {
    name: 'no_copy',
    summary: 'Prevent a function block instance from being copied.',
    description:
      'When applied to a FUNCTION_BLOCK, prevents instances from being copied by the runtime. ' +
      'Essential for FBs that manage exclusive resources such as communication channels or hardware handles.',
    example: "{attribute 'no_copy'}",
  },
  {
    name: 'pack_mode',
    summary: 'Control struct member alignment/packing.',
    description:
      'Sets the byte-alignment packing mode for a STRUCT or UNION. ' +
      'A value of `1` means no padding (byte-aligned). ' +
      'Values `2`, `4`, or `8` align members to the specified boundary. ' +
      'Use this when a struct must exactly match an external memory layout.',
    example: "{attribute 'pack_mode' := '1'}",
  },
  {
    name: 'qualified_only',
    summary: 'Require enum values to be qualified with the enum name.',
    description:
      'Applied to ENUM declarations. Forces callers to use the qualified form `EnumName.Value` ' +
      'instead of the bare `Value`. Prevents accidental name collisions across enumerations.',
    example: "{attribute 'qualified_only'}",
  },
  {
    name: 'to_string',
    summary: 'Generate a ToString() conversion method for an enum.',
    description:
      'When applied to an ENUM, the TwinCAT compiler generates an automatic `ToString()` helper ' +
      'that converts enum members to their string representation. Useful for logging and diagnostics.',
    example: "{attribute 'to_string'}",
  },
  {
    name: 'reflection',
    summary: 'Enable runtime type reflection for a variable or POU.',
    description:
      'Includes the symbol in the TwinCAT ADS reflection database so it can be inspected at ' +
      'runtime via the `FB_GetAttributeByName` and related reflection function blocks.',
    example: "{attribute 'reflection'}",
  },
  {
    name: 'call_after_init',
    summary: 'Call the FB after initialization completes.',
    description:
      'Instructs the runtime to call the function block one additional time immediately after ' +
      'the PLC program has been initialized but before the first regular scan cycle.',
    example: "{attribute 'call_after_init'}",
  },
  {
    name: 'TcNoFPU',
    summary: 'Disable floating-point unit for this POU.',
    description:
      'Marks a POU so that the code generator does not use FPU instructions. ' +
      'Required when the code may run on a task or core that does not support floating-point operations.',
    example: "{attribute 'TcNoFPU'}",
  },
  {
    name: 'enable_dynamic_creation',
    summary: 'Allow dynamic creation of FB instances at runtime.',
    description:
      'Allows instances of this function block to be created dynamically at runtime ' +
      'using `__NEW`. Without this attribute the compiler rejects dynamic instantiation.',
    example: "{attribute 'enable_dynamic_creation'}",
  },
  {
    name: 'OPC.UA.DA',
    summary: 'Expose variable via OPC UA Data Access.',
    description:
      'Marks a variable for publication on the OPC UA server built into TwinCAT. ' +
      'The attribute value can carry additional OPC UA node configuration such as access level.',
    example: "{attribute 'OPC.UA.DA' := '1'}",
  },
];

/** Look up documentation for a pragma attribute by name (case-insensitive). */
export function findPragmaDoc(name: string): PragmaDoc | undefined {
  const lower = name.toLowerCase();
  return PRAGMA_DOCS.find(p => p.name.toLowerCase() === lower);
}

/** Render hover markdown for a pragma. */
export function pragmaHover(doc: PragmaDoc): string {
  const lines: string[] = [
    `**\`{attribute '${doc.name}'}\`** — ${doc.summary}`,
    '',
    doc.description,
  ];
  if (doc.example) {
    lines.push('', `*Example:* \`${doc.example}\``);
  }
  return lines.join('\n');
}
