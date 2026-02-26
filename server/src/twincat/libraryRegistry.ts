/**
 * Beckhoff TwinCAT 3 standard library symbol catalog.
 *
 * Covers the four most common Beckhoff standard libraries:
 *   - Tc2_Standard   (timers, counters, bistables, edge detectors, string/math functions)
 *   - Tc2_System     (system time, task info, logging)
 *   - Tc2_MC2        (motion control)
 *   - Tc2_Utilities  (conversion utilities)
 */

// ── Shared parameter type ─────────────────────────────────────────────────────

export interface FBParam {
  name: string;
  type: string;
  description: string;
}

// ── Library types ─────────────────────────────────────────────────────────────

export interface MethodSignature {
  name: string;
  params: FBParam[];
  returnType: string;
  description: string;
}

export interface LibraryFB {
  name: string;
  namespace: string;
  description: string;
  inputs: FBParam[];
  outputs: FBParam[];
  methods?: MethodSignature[];
}

export interface LibraryFunction {
  name: string;
  namespace: string;
  description: string;
  params: FBParam[];
  returnType: string;
}

export interface LibraryGVL {
  /** GVL name, e.g. 'TcGENSYS' */
  name: string;
  namespace: string;
  variables: { name: string; type: string; description: string }[];
}

// ── Tc2_Standard ──────────────────────────────────────────────────────────────

const TC2_STANDARD_FBS: LibraryFB[] = [
  // Timers
  {
    name: 'TON',
    namespace: 'Tc2_Standard',
    description:
      'On-delay timer (PLCopen). The output Q goes TRUE after the input IN has been TRUE continuously for the duration PT.',
    inputs: [
      { name: 'IN', type: 'BOOL', description: 'Timer input (start trigger).' },
      { name: 'PT', type: 'TIME', description: 'Preset time (delay duration).' },
    ],
    outputs: [
      { name: 'Q', type: 'BOOL', description: 'Output: TRUE when ET ≥ PT.' },
      { name: 'ET', type: 'TIME', description: 'Elapsed time since IN went TRUE.' },
    ],
  },
  {
    name: 'TOF',
    namespace: 'Tc2_Standard',
    description:
      'Off-delay timer (PLCopen). The output Q stays TRUE for the duration PT after the input IN goes FALSE.',
    inputs: [
      { name: 'IN', type: 'BOOL', description: 'Timer input; rising edge starts Q, falling edge starts delay.' },
      { name: 'PT', type: 'TIME', description: 'Preset time (delay duration).' },
    ],
    outputs: [
      { name: 'Q', type: 'BOOL', description: 'Output: TRUE while IN is TRUE or while elapsed < PT.' },
      { name: 'ET', type: 'TIME', description: 'Elapsed time since IN went FALSE.' },
    ],
  },
  {
    name: 'TP',
    namespace: 'Tc2_Standard',
    description:
      'Pulse timer (PLCopen). A rising edge on IN generates a fixed-length pulse of duration PT on Q.',
    inputs: [
      { name: 'IN', type: 'BOOL', description: 'Trigger input; rising edge starts the pulse.' },
      { name: 'PT', type: 'TIME', description: 'Pulse duration.' },
    ],
    outputs: [
      { name: 'Q', type: 'BOOL', description: 'Pulse output: TRUE for PT after rising edge on IN.' },
      { name: 'ET', type: 'TIME', description: 'Elapsed time since the pulse started.' },
    ],
  },

  // Counters
  {
    name: 'CTU',
    namespace: 'Tc2_Standard',
    description:
      'Up-counter (PLCopen). Counts rising edges on CU up to PV. Output Q goes TRUE when CV ≥ PV.',
    inputs: [
      { name: 'CU', type: 'BOOL', description: 'Count up: counted on each rising edge.' },
      { name: 'R', type: 'BOOL', description: 'Reset: sets CV to 0 when TRUE.' },
      { name: 'PV', type: 'INT', description: 'Preset value (upper limit).' },
    ],
    outputs: [
      { name: 'Q', type: 'BOOL', description: 'TRUE when CV ≥ PV.' },
      { name: 'CV', type: 'INT', description: 'Current count value.' },
    ],
  },
  {
    name: 'CTD',
    namespace: 'Tc2_Standard',
    description:
      'Down-counter (PLCopen). Loaded with PV on LD; counts down on rising edges on CD. Output Q goes TRUE when CV ≤ 0.',
    inputs: [
      { name: 'CD', type: 'BOOL', description: 'Count down: counted on each rising edge.' },
      { name: 'LD', type: 'BOOL', description: 'Load: sets CV to PV when TRUE.' },
      { name: 'PV', type: 'INT', description: 'Preset value (initial count).' },
    ],
    outputs: [
      { name: 'Q', type: 'BOOL', description: 'TRUE when CV ≤ 0.' },
      { name: 'CV', type: 'INT', description: 'Current count value.' },
    ],
  },
  {
    name: 'CTUD',
    namespace: 'Tc2_Standard',
    description:
      'Up/Down-counter (PLCopen). Counts rising edges on CU up and on CD down. Reset R sets CV to 0; Load LD sets CV to PV.',
    inputs: [
      { name: 'CU', type: 'BOOL', description: 'Count up on rising edge.' },
      { name: 'CD', type: 'BOOL', description: 'Count down on rising edge.' },
      { name: 'R', type: 'BOOL', description: 'Reset: sets CV to 0.' },
      { name: 'LD', type: 'BOOL', description: 'Load: sets CV to PV.' },
      { name: 'PV', type: 'INT', description: 'Preset value.' },
    ],
    outputs: [
      { name: 'QU', type: 'BOOL', description: 'TRUE when CV ≥ PV.' },
      { name: 'QD', type: 'BOOL', description: 'TRUE when CV ≤ 0.' },
      { name: 'CV', type: 'INT', description: 'Current count value.' },
    ],
  },

  // Bistables
  {
    name: 'RS',
    namespace: 'Tc2_Standard',
    description:
      'RS bistable (Reset-dominant, PLCopen). Output Q1 is SET by S and RESET by R1. When both are TRUE, RESET wins.',
    inputs: [
      { name: 'S', type: 'BOOL', description: 'Set input.' },
      { name: 'R1', type: 'BOOL', description: 'Reset input (dominant).' },
    ],
    outputs: [
      { name: 'Q1', type: 'BOOL', description: 'Bistable output.' },
    ],
  },
  {
    name: 'SR',
    namespace: 'Tc2_Standard',
    description:
      'SR bistable (Set-dominant, PLCopen). Output Q1 is SET by S1 and RESET by R. When both are TRUE, SET wins.',
    inputs: [
      { name: 'S1', type: 'BOOL', description: 'Set input (dominant).' },
      { name: 'R', type: 'BOOL', description: 'Reset input.' },
    ],
    outputs: [
      { name: 'Q1', type: 'BOOL', description: 'Bistable output.' },
    ],
  },

  // Edge detectors
  {
    name: 'R_TRIG',
    namespace: 'Tc2_Standard',
    description:
      'Rising-edge detector (PLCopen). Output Q is TRUE for exactly one cycle when CLK transitions from FALSE to TRUE.',
    inputs: [
      { name: 'CLK', type: 'BOOL', description: 'Signal to detect rising edges on.' },
    ],
    outputs: [
      { name: 'Q', type: 'BOOL', description: 'TRUE for one cycle on a rising edge of CLK.' },
    ],
  },
  {
    name: 'F_TRIG',
    namespace: 'Tc2_Standard',
    description:
      'Falling-edge detector (PLCopen). Output Q is TRUE for exactly one cycle when CLK transitions from TRUE to FALSE.',
    inputs: [
      { name: 'CLK', type: 'BOOL', description: 'Signal to detect falling edges on.' },
    ],
    outputs: [
      { name: 'Q', type: 'BOOL', description: 'TRUE for one cycle on a falling edge of CLK.' },
    ],
  },

  // Semaphore
  {
    name: 'SEMA',
    namespace: 'Tc2_Standard',
    description:
      'Semaphore (Tc2_Standard). Provides a simple mutual-exclusion mechanism. CLAIM acquires the lock; RELEASE releases it. BUSY is TRUE while the semaphore is held.',
    inputs: [
      { name: 'CLAIM', type: 'BOOL', description: 'Attempt to acquire the semaphore on rising edge.' },
      { name: 'RELEASE', type: 'BOOL', description: 'Release the semaphore on rising edge.' },
    ],
    outputs: [
      { name: 'BUSY', type: 'BOOL', description: 'TRUE while the semaphore is currently held.' },
    ],
  },
];

const TC2_STANDARD_FUNCTIONS: LibraryFunction[] = [
  // Selection
  {
    name: 'SEL',
    namespace: 'Tc2_Standard',
    description: 'Binary selection. Returns IN0 if G is FALSE, IN1 if G is TRUE.',
    params: [
      { name: 'G', type: 'BOOL', description: 'Selector: FALSE → IN0, TRUE → IN1.' },
      { name: 'IN0', type: 'ANY', description: 'Value returned when G is FALSE.' },
      { name: 'IN1', type: 'ANY', description: 'Value returned when G is TRUE.' },
    ],
    returnType: 'ANY',
  },
  {
    name: 'MUX',
    namespace: 'Tc2_Standard',
    description: 'Multiplexer. Returns the K-th input (0-based) from up to N inputs.',
    params: [
      { name: 'K', type: 'INT', description: 'Zero-based index of the input to select.' },
      { name: 'IN0', type: 'ANY', description: 'First input (index 0).' },
      { name: 'IN1', type: 'ANY', description: 'Second input (index 1).' },
    ],
    returnType: 'ANY',
  },
  {
    name: 'LIMIT',
    namespace: 'Tc2_Standard',
    description: 'Clamps IN to the range [MN, MX]. Returns MN if IN < MN, MX if IN > MX, else IN.',
    params: [
      { name: 'MN', type: 'ANY_NUM', description: 'Lower bound (minimum value).' },
      { name: 'IN', type: 'ANY_NUM', description: 'Input value to clamp.' },
      { name: 'MX', type: 'ANY_NUM', description: 'Upper bound (maximum value).' },
    ],
    returnType: 'ANY_NUM',
  },
  {
    name: 'MIN',
    namespace: 'Tc2_Standard',
    description: 'Returns the lesser of IN0 and IN1.',
    params: [
      { name: 'IN0', type: 'ANY_NUM', description: 'First operand.' },
      { name: 'IN1', type: 'ANY_NUM', description: 'Second operand.' },
    ],
    returnType: 'ANY_NUM',
  },
  {
    name: 'MAX',
    namespace: 'Tc2_Standard',
    description: 'Returns the greater of IN0 and IN1.',
    params: [
      { name: 'IN0', type: 'ANY_NUM', description: 'First operand.' },
      { name: 'IN1', type: 'ANY_NUM', description: 'Second operand.' },
    ],
    returnType: 'ANY_NUM',
  },
  {
    name: 'ABS',
    namespace: 'Tc2_Standard',
    description: 'Returns the absolute value of IN.',
    params: [
      { name: 'IN', type: 'ANY_NUM', description: 'Input value.' },
    ],
    returnType: 'ANY_NUM',
  },
  {
    name: 'TRUNC',
    namespace: 'Tc2_Standard',
    description: 'Truncates a floating-point number toward zero, returning an integer.',
    params: [
      { name: 'IN', type: 'ANY_REAL', description: 'Floating-point input.' },
    ],
    returnType: 'ANY_INT',
  },
  {
    name: 'MOVE',
    namespace: 'Tc2_Standard',
    description: 'Returns the value of IN unchanged (assignment in functional notation).',
    params: [
      { name: 'IN', type: 'ANY', description: 'Value to pass through.' },
    ],
    returnType: 'ANY',
  },

  // Memory
  {
    name: 'memcpy',
    namespace: 'Tc2_Standard',
    description: 'Copies n bytes from the memory area pointed to by pSrc to pDest.',
    params: [
      { name: 'pDest', type: 'PVOID', description: 'Pointer to destination memory area.' },
      { name: 'pSrc', type: 'PVOID', description: 'Pointer to source memory area.' },
      { name: 'n', type: 'UDINT', description: 'Number of bytes to copy.' },
    ],
    returnType: 'PVOID',
  },
  {
    name: 'memset',
    namespace: 'Tc2_Standard',
    description: 'Fills the first n bytes of the memory area pointed to by pDest with the constant byte iValue.',
    params: [
      { name: 'pDest', type: 'PVOID', description: 'Pointer to the memory area to fill.' },
      { name: 'iValue', type: 'SINT', description: 'Byte value to fill with.' },
      { name: 'n', type: 'UDINT', description: 'Number of bytes to fill.' },
    ],
    returnType: 'PVOID',
  },

  // String functions
  {
    name: 'LEN',
    namespace: 'Tc2_Standard',
    description: 'Returns the current length (number of characters) of STR.',
    params: [
      { name: 'STR', type: 'STRING', description: 'Input string.' },
    ],
    returnType: 'INT',
  },
  {
    name: 'LEFT',
    namespace: 'Tc2_Standard',
    description: 'Returns the leftmost SIZE characters of STR.',
    params: [
      { name: 'STR', type: 'STRING', description: 'Input string.' },
      { name: 'SIZE', type: 'INT', description: 'Number of characters to return.' },
    ],
    returnType: 'STRING',
  },
  {
    name: 'RIGHT',
    namespace: 'Tc2_Standard',
    description: 'Returns the rightmost SIZE characters of STR.',
    params: [
      { name: 'STR', type: 'STRING', description: 'Input string.' },
      { name: 'SIZE', type: 'INT', description: 'Number of characters to return.' },
    ],
    returnType: 'STRING',
  },
  {
    name: 'MID',
    namespace: 'Tc2_Standard',
    description: 'Returns LEN characters from STR starting at position POS (1-based).',
    params: [
      { name: 'STR', type: 'STRING', description: 'Input string.' },
      { name: 'LEN', type: 'INT', description: 'Number of characters to extract.' },
      { name: 'POS', type: 'INT', description: 'Starting position (1-based).' },
    ],
    returnType: 'STRING',
  },
  {
    name: 'CONCAT',
    namespace: 'Tc2_Standard',
    description: 'Concatenates STR1 and STR2, returning the combined string.',
    params: [
      { name: 'STR1', type: 'STRING', description: 'First string.' },
      { name: 'STR2', type: 'STRING', description: 'Second string to append.' },
    ],
    returnType: 'STRING',
  },
  {
    name: 'INSERT',
    namespace: 'Tc2_Standard',
    description: 'Inserts STR2 into STR1 after position POS (1-based).',
    params: [
      { name: 'STR1', type: 'STRING', description: 'Base string.' },
      { name: 'STR2', type: 'STRING', description: 'String to insert.' },
      { name: 'POS', type: 'INT', description: 'Insert position in STR1 (1-based).' },
    ],
    returnType: 'STRING',
  },
  {
    name: 'DELETE',
    namespace: 'Tc2_Standard',
    description: 'Deletes LEN characters from STR starting at position POS (1-based).',
    params: [
      { name: 'STR', type: 'STRING', description: 'Input string.' },
      { name: 'LEN', type: 'INT', description: 'Number of characters to delete.' },
      { name: 'POS', type: 'INT', description: 'Starting position of deletion (1-based).' },
    ],
    returnType: 'STRING',
  },
  {
    name: 'REPLACE',
    namespace: 'Tc2_Standard',
    description: 'Replaces LEN characters in STR1 starting at POS with STR2.',
    params: [
      { name: 'STR1', type: 'STRING', description: 'Base string.' },
      { name: 'STR2', type: 'STRING', description: 'Replacement string.' },
      { name: 'LEN', type: 'INT', description: 'Number of characters to replace in STR1.' },
      { name: 'POS', type: 'INT', description: 'Starting position of replacement (1-based).' },
    ],
    returnType: 'STRING',
  },
  {
    name: 'FIND',
    namespace: 'Tc2_Standard',
    description: 'Returns the position of the first occurrence of STR2 in STR1 (1-based), or 0 if not found.',
    params: [
      { name: 'STR1', type: 'STRING', description: 'String to search within.' },
      { name: 'STR2', type: 'STRING', description: 'Substring to find.' },
    ],
    returnType: 'INT',
  },
];

// ── Tc2_System ────────────────────────────────────────────────────────────────

const TC2_SYSTEM_FBS: LibraryFB[] = [
  {
    name: 'FB_GetSystemTime',
    namespace: 'Tc2_System',
    description:
      'Reads the current system time as a Windows FILETIME (100-nanosecond intervals since 1601-01-01). Call each cycle with bEnable TRUE.',
    inputs: [
      { name: 'bEnable', type: 'BOOL', description: 'Enable the FB; read is performed each cycle while TRUE.' },
    ],
    outputs: [
      { name: 'timeLoDW', type: 'UDINT', description: 'Low DWORD of the FILETIME value.' },
      { name: 'timeHiDW', type: 'UDINT', description: 'High DWORD of the FILETIME value.' },
    ],
  },
  {
    name: 'FB_LocalSystemTime',
    namespace: 'Tc2_System',
    description:
      'Reads the current local system time as individual date/time components. Refreshed each cycle when bEnable is TRUE.',
    inputs: [
      { name: 'bEnable', type: 'BOOL', description: 'Enable the FB; local time is read each cycle while TRUE.' },
    ],
    outputs: [
      { name: 'bValid', type: 'BOOL', description: 'TRUE when the output values are valid.' },
      { name: 'systemTime', type: 'TIMESTRUCT', description: 'Current local time as a TIMESTRUCT (year, month, day, hour, minute, second, ms).' },
      { name: 'dwDate', type: 'DWORD', description: 'Date encoded as YYYYMMDD.' },
      { name: 'dwTime', type: 'DWORD', description: 'Time encoded as HHMMSSmmm.' },
    ],
  },
  {
    name: 'FB_GetTaskIdx',
    namespace: 'Tc2_System',
    description:
      'Returns the index (0-based) of the PLC task that called this FB. Useful for task-aware diagnostics.',
    inputs: [],
    outputs: [
      { name: 'index', type: 'UDINT', description: 'Zero-based task index of the calling task.' },
    ],
  },
  {
    name: 'NT_GetTime',
    namespace: 'Tc2_System',
    description:
      'Retrieves the current time from a Windows time service or NTP server. Asynchronous: trigger with START and poll BUSY/ERR.',
    inputs: [
      { name: 'NETID', type: 'T_AmsNetId', description: 'AMS Net ID of the target device (empty string for local).' },
      { name: 'START', type: 'BOOL', description: 'Rising edge triggers the time request.' },
      { name: 'TMOUT', type: 'TIME', description: 'Timeout for the request.' },
    ],
    outputs: [
      { name: 'BUSY', type: 'BOOL', description: 'TRUE while the request is in progress.' },
      { name: 'ERR', type: 'BOOL', description: 'TRUE if the request failed.' },
      { name: 'ERRID', type: 'UDINT', description: 'ADS error code if ERR is TRUE.' },
      { name: 'TIMESTR', type: 'TIMESTRUCT', description: 'Retrieved time as a TIMESTRUCT when BUSY goes FALSE and ERR is FALSE.' },
    ],
  },
  {
    name: 'ADSLOGSTR',
    namespace: 'Tc2_System',
    description:
      'Writes a formatted string message to the TwinCAT ADS logger (visible in TwinCAT XAE / EventLogger).',
    inputs: [
      { name: 'LOGTYPE', type: 'DWORD', description: 'Log level: ADSLOG_MSGTYPE_HINT (1), ADSLOG_MSGTYPE_WARN (2), ADSLOG_MSGTYPE_ERROR (4).' },
      { name: 'MSGFMT', type: 'STRING', description: 'Format string (printf-style, with %s placeholder).' },
      { name: 'STRARG', type: 'STRING', description: 'String argument substituted for the %s placeholder.' },
    ],
    outputs: [],
  },
];

const TC2_SYSTEM_GVLS: LibraryGVL[] = [
  {
    name: 'TcGENSYS',
    namespace: 'Tc2_System',
    variables: [
      { name: 'MAIN_CYCLE_COUNT', type: 'ULINT', description: 'Increments by 1 on every PLC cycle. Rolls over at ULINT maximum.' },
      { name: 'TASKTIME', type: 'UDINT', description: 'Total PLC task runtime in milliseconds since TwinCAT start.' },
    ],
  },
  {
    name: 'TcTask',
    namespace: 'Tc2_System',
    variables: [
      { name: 'CycleTime', type: 'UDINT', description: 'Configured task cycle time in 100-nanosecond units.' },
      { name: 'CycleCount', type: 'UDINT', description: 'Number of cycles executed since TwinCAT start (wraps).' },
      { name: 'LastExecTime', type: 'UDINT', description: 'Execution time of the last cycle in 100-nanosecond units.' },
      { name: 'FirstCycle', type: 'BOOL', description: 'TRUE only during the very first execution cycle after start.' },
    ],
  },
];

// ── Tc2_MC2 ───────────────────────────────────────────────────────────────────

const TC2_MC2_FBS: LibraryFB[] = [
  {
    name: 'MC_Power',
    namespace: 'Tc2_MC2',
    description:
      'Enables or disables the power stage of a drive axis. The axis must be powered before motion commands are issued.',
    inputs: [
      { name: 'Axis', type: 'AXIS_REF', description: 'Reference to the axis to control.' },
      { name: 'Enable', type: 'BOOL', description: 'Enable the power stage while TRUE.' },
      { name: 'Enable_Positive', type: 'BOOL', description: 'Allow motion in positive direction.' },
      { name: 'Enable_Negative', type: 'BOOL', description: 'Allow motion in negative direction.' },
      { name: 'Override', type: 'LREAL', description: 'Velocity override factor (0–100 %).' },
    ],
    outputs: [
      { name: 'Status', type: 'BOOL', description: 'TRUE when the power stage is active and the drive is operational.' },
      { name: 'Busy', type: 'BOOL', description: 'TRUE while the power enable/disable is in transition.' },
      { name: 'Active', type: 'BOOL', description: 'TRUE when the FB is controlling the axis.' },
      { name: 'Error', type: 'BOOL', description: 'TRUE if an error has occurred.' },
      { name: 'ErrorID', type: 'UDINT', description: 'NC error code if Error is TRUE.' },
    ],
  },
  {
    name: 'MC_Reset',
    namespace: 'Tc2_MC2',
    description:
      'Resets axis errors and transitions the axis from ErrorStop state to Standstill. Rising edge on Execute triggers the reset.',
    inputs: [
      { name: 'Axis', type: 'AXIS_REF', description: 'Reference to the axis to reset.' },
      { name: 'Execute', type: 'BOOL', description: 'Rising edge triggers the reset command.' },
    ],
    outputs: [
      { name: 'Done', type: 'BOOL', description: 'TRUE for one cycle when the reset completed successfully.' },
      { name: 'Busy', type: 'BOOL', description: 'TRUE while the reset is in progress.' },
      { name: 'Error', type: 'BOOL', description: 'TRUE if the reset failed.' },
      { name: 'ErrorID', type: 'UDINT', description: 'NC error code if Error is TRUE.' },
    ],
  },
  {
    name: 'MC_Home',
    namespace: 'Tc2_MC2',
    description:
      'Executes a homing sequence on the axis to establish the axis reference position. The specific homing behaviour depends on HomingMode.',
    inputs: [
      { name: 'Axis', type: 'AXIS_REF', description: 'Reference to the axis to home.' },
      { name: 'Execute', type: 'BOOL', description: 'Rising edge starts the homing sequence.' },
      { name: 'Position', type: 'LREAL', description: 'Position value assigned to the axis at the homing point.' },
      { name: 'HomingMode', type: 'MC_HomingMode', description: 'Homing mode enumeration (e.g. MC_DefaultHoming).' },
      { name: 'Velocity', type: 'LREAL', description: 'Search velocity for the homing switch.' },
      { name: 'Acceleration', type: 'LREAL', description: 'Acceleration during homing.' },
      { name: 'Deceleration', type: 'LREAL', description: 'Deceleration during homing.' },
      { name: 'Jerk', type: 'LREAL', description: 'Jerk limit during homing (0 = not limited).' },
    ],
    outputs: [
      { name: 'Done', type: 'BOOL', description: 'TRUE for one cycle when homing completed.' },
      { name: 'Busy', type: 'BOOL', description: 'TRUE while homing is in progress.' },
      { name: 'Active', type: 'BOOL', description: 'TRUE when the FB is actively moving the axis.' },
      { name: 'CommandAborted', type: 'BOOL', description: 'TRUE if the homing was aborted by another command.' },
      { name: 'Error', type: 'BOOL', description: 'TRUE if homing failed.' },
      { name: 'ErrorID', type: 'UDINT', description: 'NC error code if Error is TRUE.' },
    ],
  },
  {
    name: 'MC_MoveAbsolute',
    namespace: 'Tc2_MC2',
    description:
      'Commands the axis to move to an absolute target position at the specified velocity, acceleration, and deceleration.',
    inputs: [
      { name: 'Axis', type: 'AXIS_REF', description: 'Reference to the axis to move.' },
      { name: 'Execute', type: 'BOOL', description: 'Rising edge starts the move.' },
      { name: 'Position', type: 'LREAL', description: 'Absolute target position.' },
      { name: 'Velocity', type: 'LREAL', description: 'Maximum velocity.' },
      { name: 'Acceleration', type: 'LREAL', description: 'Acceleration ramp.' },
      { name: 'Deceleration', type: 'LREAL', description: 'Deceleration ramp.' },
      { name: 'Jerk', type: 'LREAL', description: 'Jerk limit (0 = not limited).' },
      { name: 'Direction', type: 'MC_Direction', description: 'Preferred direction of motion.' },
      { name: 'BufferMode', type: 'MC_BufferMode', description: 'Buffer mode for command queuing.' },
    ],
    outputs: [
      { name: 'Done', type: 'BOOL', description: 'TRUE for one cycle when the target position is reached.' },
      { name: 'Busy', type: 'BOOL', description: 'TRUE while the move is in progress.' },
      { name: 'Active', type: 'BOOL', description: 'TRUE when this FB is controlling the axis.' },
      { name: 'CommandAborted', type: 'BOOL', description: 'TRUE if the move was interrupted.' },
      { name: 'Error', type: 'BOOL', description: 'TRUE if the move failed.' },
      { name: 'ErrorID', type: 'UDINT', description: 'NC error code if Error is TRUE.' },
    ],
  },
  {
    name: 'MC_MoveRelative',
    namespace: 'Tc2_MC2',
    description:
      'Commands the axis to move by a relative Distance from the current position at the specified velocity, acceleration, and deceleration.',
    inputs: [
      { name: 'Axis', type: 'AXIS_REF', description: 'Reference to the axis to move.' },
      { name: 'Execute', type: 'BOOL', description: 'Rising edge starts the move.' },
      { name: 'Distance', type: 'LREAL', description: 'Relative distance to travel (positive or negative).' },
      { name: 'Velocity', type: 'LREAL', description: 'Maximum velocity.' },
      { name: 'Acceleration', type: 'LREAL', description: 'Acceleration ramp.' },
      { name: 'Deceleration', type: 'LREAL', description: 'Deceleration ramp.' },
      { name: 'Jerk', type: 'LREAL', description: 'Jerk limit (0 = not limited).' },
      { name: 'BufferMode', type: 'MC_BufferMode', description: 'Buffer mode for command queuing.' },
    ],
    outputs: [
      { name: 'Done', type: 'BOOL', description: 'TRUE for one cycle when the move is complete.' },
      { name: 'Busy', type: 'BOOL', description: 'TRUE while the move is in progress.' },
      { name: 'Active', type: 'BOOL', description: 'TRUE when this FB is controlling the axis.' },
      { name: 'CommandAborted', type: 'BOOL', description: 'TRUE if the move was interrupted.' },
      { name: 'Error', type: 'BOOL', description: 'TRUE if the move failed.' },
      { name: 'ErrorID', type: 'UDINT', description: 'NC error code if Error is TRUE.' },
    ],
  },
  {
    name: 'MC_MoveVelocity',
    namespace: 'Tc2_MC2',
    description:
      'Commands the axis to move continuously at a specified velocity. The axis accelerates to Velocity and maintains it until aborted.',
    inputs: [
      { name: 'Axis', type: 'AXIS_REF', description: 'Reference to the axis to move.' },
      { name: 'Execute', type: 'BOOL', description: 'Rising edge starts the velocity move.' },
      { name: 'Velocity', type: 'LREAL', description: 'Target velocity (sign sets direction).' },
      { name: 'Acceleration', type: 'LREAL', description: 'Acceleration ramp.' },
      { name: 'Deceleration', type: 'LREAL', description: 'Deceleration ramp.' },
      { name: 'Jerk', type: 'LREAL', description: 'Jerk limit (0 = not limited).' },
      { name: 'Direction', type: 'MC_Direction', description: 'Direction of motion.' },
      { name: 'BufferMode', type: 'MC_BufferMode', description: 'Buffer mode for command queuing.' },
    ],
    outputs: [
      { name: 'InVelocity', type: 'BOOL', description: 'TRUE when the axis has reached the commanded velocity.' },
      { name: 'Busy', type: 'BOOL', description: 'TRUE while the command is active.' },
      { name: 'Active', type: 'BOOL', description: 'TRUE when this FB is controlling the axis.' },
      { name: 'CommandAborted', type: 'BOOL', description: 'TRUE if the move was interrupted.' },
      { name: 'Error', type: 'BOOL', description: 'TRUE if the move failed.' },
      { name: 'ErrorID', type: 'UDINT', description: 'NC error code if Error is TRUE.' },
    ],
  },
  {
    name: 'MC_Stop',
    namespace: 'Tc2_MC2',
    description:
      'Decelerates the axis to zero velocity. While Execute is TRUE the axis is held in stop state; it cannot accept new motion commands until Execute goes FALSE.',
    inputs: [
      { name: 'Axis', type: 'AXIS_REF', description: 'Reference to the axis to stop.' },
      { name: 'Execute', type: 'BOOL', description: 'TRUE initiates and holds the stop command.' },
      { name: 'Deceleration', type: 'LREAL', description: 'Deceleration ramp.' },
      { name: 'Jerk', type: 'LREAL', description: 'Jerk limit (0 = not limited).' },
      { name: 'BufferMode', type: 'MC_BufferMode', description: 'Buffer mode for command queuing.' },
    ],
    outputs: [
      { name: 'Done', type: 'BOOL', description: 'TRUE when the axis has stopped (velocity = 0).' },
      { name: 'Busy', type: 'BOOL', description: 'TRUE while decelerating.' },
      { name: 'Active', type: 'BOOL', description: 'TRUE when this FB is controlling the axis.' },
      { name: 'CommandAborted', type: 'BOOL', description: 'TRUE if the stop was superseded.' },
      { name: 'Error', type: 'BOOL', description: 'TRUE if the stop failed.' },
      { name: 'ErrorID', type: 'UDINT', description: 'NC error code if Error is TRUE.' },
    ],
  },
  {
    name: 'MC_Halt',
    namespace: 'Tc2_MC2',
    description:
      'Decelerates the axis to standstill, then releases control (unlike MC_Stop, the axis can accept new commands immediately after Done).',
    inputs: [
      { name: 'Axis', type: 'AXIS_REF', description: 'Reference to the axis to halt.' },
      { name: 'Execute', type: 'BOOL', description: 'Rising edge triggers the halt.' },
      { name: 'Deceleration', type: 'LREAL', description: 'Deceleration ramp.' },
      { name: 'Jerk', type: 'LREAL', description: 'Jerk limit (0 = not limited).' },
      { name: 'BufferMode', type: 'MC_BufferMode', description: 'Buffer mode for command queuing.' },
    ],
    outputs: [
      { name: 'Done', type: 'BOOL', description: 'TRUE for one cycle when the axis has stopped.' },
      { name: 'Busy', type: 'BOOL', description: 'TRUE while decelerating.' },
      { name: 'Active', type: 'BOOL', description: 'TRUE when this FB is controlling the axis.' },
      { name: 'CommandAborted', type: 'BOOL', description: 'TRUE if the halt was aborted by another command.' },
      { name: 'Error', type: 'BOOL', description: 'TRUE if the halt failed.' },
      { name: 'ErrorID', type: 'UDINT', description: 'NC error code if Error is TRUE.' },
    ],
  },
  {
    name: 'MC_ReadStatus',
    namespace: 'Tc2_MC2',
    description:
      'Continuously reads the PLCopen state machine status of the axis while Enable is TRUE.',
    inputs: [
      { name: 'Axis', type: 'AXIS_REF', description: 'Reference to the axis to monitor.' },
      { name: 'Enable', type: 'BOOL', description: 'Enables continuous status reading while TRUE.' },
    ],
    outputs: [
      { name: 'Valid', type: 'BOOL', description: 'TRUE when the output Status is valid.' },
      { name: 'Busy', type: 'BOOL', description: 'TRUE while the read is in progress.' },
      { name: 'Error', type: 'BOOL', description: 'TRUE if the read failed.' },
      { name: 'ErrorID', type: 'UDINT', description: 'NC error code if Error is TRUE.' },
      { name: 'Disabled', type: 'BOOL', description: 'TRUE when the axis is in Disabled state.' },
      { name: 'Standstill', type: 'BOOL', description: 'TRUE when the axis is at standstill.' },
      { name: 'DiscreteMotion', type: 'BOOL', description: 'TRUE when executing a point-to-point move.' },
      { name: 'ContinuousMotion', type: 'BOOL', description: 'TRUE when executing a velocity move.' },
      { name: 'ErrorStop', type: 'BOOL', description: 'TRUE when the axis is in ErrorStop state.' },
    ],
  },
  {
    name: 'MC_ReadActualPosition',
    namespace: 'Tc2_MC2',
    description:
      'Continuously reads the actual encoder position of the axis while Enable is TRUE.',
    inputs: [
      { name: 'Axis', type: 'AXIS_REF', description: 'Reference to the axis to read.' },
      { name: 'Enable', type: 'BOOL', description: 'Enables continuous position reading while TRUE.' },
    ],
    outputs: [
      { name: 'Valid', type: 'BOOL', description: 'TRUE when Position output is valid.' },
      { name: 'Busy', type: 'BOOL', description: 'TRUE while the read is in progress.' },
      { name: 'Error', type: 'BOOL', description: 'TRUE if the read failed.' },
      { name: 'ErrorID', type: 'UDINT', description: 'NC error code if Error is TRUE.' },
      { name: 'Position', type: 'LREAL', description: 'Current actual position of the axis.' },
    ],
  },
];

/** MC_Axis_REF and MC_AxisStatus represented as queryable GVL entries. */
const TC2_MC2_GVLS: LibraryGVL[] = [
  {
    name: 'MC_Axis_REF',
    namespace: 'Tc2_MC2',
    variables: [
      { name: 'PlcToNc', type: 'PLCTONC_AXIS_REF', description: 'Cyclic data written by PLC to NC (setpoints).' },
      { name: 'NcToPlc', type: 'NCTOPLC_AXIS_REF', description: 'Cyclic data written by NC to PLC (actuals).' },
      { name: 'Status', type: 'MC_AxisStatus', description: 'Current PLCopen state machine status of the axis.' },
    ],
  },
  {
    name: 'MC_AxisStatus',
    namespace: 'Tc2_MC2',
    variables: [
      { name: 'Disabled', type: 'BOOL', description: 'Axis is in Disabled state (power off).' },
      { name: 'Standstill', type: 'BOOL', description: 'Axis is powered, at rest, ready for commands.' },
      { name: 'DiscreteMotion', type: 'BOOL', description: 'Axis is executing a point-to-point or homing move.' },
      { name: 'ContinuousMotion', type: 'BOOL', description: 'Axis is executing a velocity move.' },
      { name: 'SynchronizedMotion', type: 'BOOL', description: 'Axis is executing a cam or gearing move.' },
      { name: 'Homing', type: 'BOOL', description: 'Axis is in the homing sequence.' },
      { name: 'ConstantVelocity', type: 'BOOL', description: 'Axis has reached and holds the commanded velocity.' },
      { name: 'Accelerating', type: 'BOOL', description: 'Axis velocity is increasing.' },
      { name: 'Decelerating', type: 'BOOL', description: 'Axis velocity is decreasing.' },
      { name: 'ErrorStop', type: 'BOOL', description: 'Axis is in ErrorStop state; a reset is required.' },
      { name: 'NotReady', type: 'BOOL', description: 'Axis is not ready (initialising or internal error).' },
    ],
  },
];

// ── Tc2_Utilities ─────────────────────────────────────────────────────────────

const TC2_UTILITIES_FUNCTIONS: LibraryFunction[] = [
  {
    name: 'DWORD_TO_HEXSTR',
    namespace: 'Tc2_Utilities',
    description: 'Converts a DWORD value to its uppercase hexadecimal string representation (8 hex digits, no prefix).',
    params: [
      { name: 'val', type: 'DWORD', description: 'Value to convert.' },
    ],
    returnType: 'STRING',
  },
  {
    name: 'INT_TO_STRING',
    namespace: 'Tc2_Utilities',
    description: 'Converts an INT value to its decimal string representation.',
    params: [
      { name: 'val', type: 'INT', description: 'Integer value to convert.' },
    ],
    returnType: 'STRING',
  },
  {
    name: 'STRING_TO_INT',
    namespace: 'Tc2_Utilities',
    description: 'Parses a decimal string and returns the INT value. Returns 0 on parse error.',
    params: [
      { name: 'val', type: 'STRING', description: 'Decimal string to parse.' },
    ],
    returnType: 'INT',
  },
  {
    name: 'F_ToASCII',
    namespace: 'Tc2_Utilities',
    description: 'Formats a numeric value into an ASCII string with configurable width and decimal places.',
    params: [
      { name: 'in', type: 'LREAL', description: 'Numeric value to format.' },
      { name: 'iPrecision', type: 'INT', description: 'Number of decimal digits.' },
    ],
    returnType: 'STRING',
  },
  {
    name: 'REPLACE_CHAR',
    namespace: 'Tc2_Utilities',
    description: 'Replaces every occurrence of byToReplace in sIn with byReplaceWith, returning the modified string.',
    params: [
      { name: 'sIn', type: 'STRING', description: 'Input string.' },
      { name: 'byToReplace', type: 'BYTE', description: 'ASCII code of the character to replace.' },
      { name: 'byReplaceWith', type: 'BYTE', description: 'ASCII code of the replacement character.' },
    ],
    returnType: 'STRING',
  },
];

// ── Registry ──────────────────────────────────────────────────────────────────

const FB_REGISTRY: Record<string, LibraryFB[]> = {
  Tc2_Standard: TC2_STANDARD_FBS,
  Tc2_System: TC2_SYSTEM_FBS,
  Tc2_MC2: TC2_MC2_FBS,
  Tc2_Utilities: [],
};

const FUNCTION_REGISTRY: Record<string, LibraryFunction[]> = {
  Tc2_Standard: TC2_STANDARD_FUNCTIONS,
  Tc2_System: [],
  Tc2_MC2: [],
  Tc2_Utilities: TC2_UTILITIES_FUNCTIONS,
};

const GVL_REGISTRY: Record<string, LibraryGVL[]> = {
  Tc2_Standard: [],
  Tc2_System: TC2_SYSTEM_GVLS,
  Tc2_MC2: TC2_MC2_GVLS,
  Tc2_Utilities: [],
};

/**
 * Returns all function blocks defined in the given library, or all
 * function blocks across every library when libName is omitted.
 */
export function getLibraryFBs(libName?: string): LibraryFB[] {
  if (libName === undefined) {
    return Object.values(FB_REGISTRY).flat();
  }
  return FB_REGISTRY[libName] ?? [];
}

/**
 * Returns all functions defined in the given library, or all functions
 * across every library when libName is omitted.
 */
export function getLibraryFunctions(libName?: string): LibraryFunction[] {
  if (libName === undefined) {
    return Object.values(FUNCTION_REGISTRY).flat();
  }
  return FUNCTION_REGISTRY[libName] ?? [];
}

/**
 * Returns all GVL entries defined in the given library, or all GVL entries
 * across every library when libName is omitted.
 */
export function getLibraryGVL(libName?: string): LibraryGVL[] {
  if (libName === undefined) {
    return Object.values(GVL_REGISTRY).flat();
  }
  return GVL_REGISTRY[libName] ?? [];
}
