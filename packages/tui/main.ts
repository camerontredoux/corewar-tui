/**
 * Terminal UI entry point (`bun run start`). Restores the terminal on quit,
 * Ctrl+C, termination signals and uncaught errors.
 */

import { createCliRenderer } from '@opentui/core';
import { createApp } from './app.ts';
import { WarriorLibrary } from './library.ts';
import { defaultConfigPath } from './prefs.ts';
import { HEX } from './theme.ts';

const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    exitSignals: [],
    targetFps: 60,
    useMouse: true,
    enableMouseMovement: true,
    backgroundColor: HEX.bg,
    // console.log would otherwise be captured into an overlay; the app does not log.
    consoleMode: 'disabled',
});

let exiting = false;
async function shutdown(code: number, error?: unknown): Promise<never> {
    if (!exiting) {
        exiting = true;
        app?.destroy();
        renderer.destroy();
        await renderer.closed.catch(() => {});
        if (error !== undefined) console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
    process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const) {
    process.on(signal, () => void shutdown(130));
}
process.on('uncaughtException', (e) => void shutdown(1, e));
process.on('unhandledRejection', (e) => void shutdown(1, e));

let app: ReturnType<typeof createApp> | undefined;
try {
    // COREWAR_WARRIORS_DIR moves warriors/ (where the editor saves new warriors) elsewhere.
    const library = new WarriorLibrary(process.cwd(), { warriorsDir: process.env.COREWAR_WARRIORS_DIR || undefined });
    app = createApp(renderer, { library, configPath: defaultConfigPath(), onQuit: () => void shutdown(0) });
} catch (e) {
    await shutdown(1, e);
}
