import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// mpos coordinates are in pixels of the image export resolution times 12. Pinning the
// resolution makes them independent of the user's MuseScore preferences.
export const MPOS_RESOLUTION_DPI = 100;
export const MPOS_UNITS_PER_INCH = MPOS_RESOLUTION_DPI * 12;

const CONVERSION_TIMEOUT_MS = 2 * 60 * 1000;

const CANDIDATE_PATHS = [
  "C:\\Program Files\\MuseScore 4\\bin\\MuseScore4.exe",
  "C:\\Program Files\\MuseScore 3\\bin\\MuseScore3.exe",
  "/Applications/MuseScore 4.app/Contents/MacOS/mscore",
  "/usr/bin/mscore4portable",
  "/usr/bin/musescore",
  "/usr/bin/mscore",
  "/usr/local/bin/mscore",
];

const PATH_COMMANDS = ["mscore4portable", "musescore4", "musescore", "mscore", "MuseScore4"];

async function isRunnable(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ["--version"], { timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds a MuseScore executable. `MUSESCORE_PATH` takes precedence over well-known install
 * locations and commands on the PATH.
 */
export async function findMuseScore(): Promise<string> {
  const fromEnv = process.env.MUSESCORE_PATH;
  if (fromEnv) {
    return fromEnv;
  }

  const installed = CANDIDATE_PATHS.find(path => existsSync(path));
  if (installed) {
    return installed;
  }

  for (const command of PATH_COMMANDS) {
    if (await isRunnable(command)) {
      return command;
    }
  }

  throw new Error("MuseScore was not found. Install MuseScore 4 or set MUSESCORE_PATH to its executable.");
}

export async function getMuseScoreVersion(executable: string): Promise<string> {
  const { stdout } = await execFileAsync(executable, ["--version"], { timeout: 30_000 });
  return stdout.trim();
}

export type ConversionOptions = {
  executable: string;
  input: string;
  outputs: string[];
  styleFile?: string;
};

export async function convertWithMuseScore({ executable, input, outputs, styleFile }: ConversionOptions): Promise<void> {
  const styleArgs = styleFile ? ["--style", styleFile] : [];
  const needsHeadlessQt = process.platform === "linux" && !process.env.QT_QPA_PLATFORM;
  const env = needsHeadlessQt ? { ...process.env, QT_QPA_PLATFORM: "offscreen" } : process.env;

  for (const output of outputs) {
    await execFileAsync(
      executable,
      ["--image-resolution", String(MPOS_RESOLUTION_DPI), ...styleArgs, "--export-to", output, input],
      { timeout: CONVERSION_TIMEOUT_MS, env },
    );

    if (!existsSync(output)) {
      throw new Error(`MuseScore did not create '${output}'.`);
    }
  }
}

export type MposElement = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Parses MuseScore's measure position export into boxes in its native units. */
export function parseMpos(xml: string): MposElement[] {
  const elementPattern = /<element\s+id="(\d+)"\s+x="([\d.]+)"\s+y="([\d.]+)"\s+sx="([\d.]+)"\s+sy="([\d.]+)"\s+page="(\d+)"/g;

  return [...xml.matchAll(elementPattern)]
    .map(match => ({
      id: Number(match[1]),
      element: {
        x: Number(match[2]),
        y: Number(match[3]),
        width: Number(match[4]),
        height: Number(match[5]),
        page: Number(match[6]),
      },
    }))
    .sort((a, b) => a.id - b.id)
    .map(({ element }) => element);
}
