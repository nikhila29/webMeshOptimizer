// gltfpack.worker.js
/**  A Web Worker that:
 * Initializes the gltfpack WASM module
 * Writes input GLB to virtual filesystem
 * Runs gltfpack with command-line arguments
 * Reads and returns the optimized output
 * Background processing (non-blocking UI) 
 * Manages gltfpack WASM module lifecycle (init, run, cleanup)
 * manages gltfpack.js
**/

let gltfpackModule = null;

// Dynamically import WASM module only when initialized
onmessage = async (e) => {
    const { type, data, args } = e.data;

    // Initialize gltfpack once
    if (type === "init") {
        if (!gltfpackModule) {
            // Dynamically import gltfpack module
            importScripts("./gltfpack.js");

            gltfpackModule = await createGltfpack({
                noInitialRun: true,
                noExitRuntime: true,
                locateFile: (path) => {
                    // Tell the module where to find the .wasm file
                    if (path.endsWith(".wasm")) return "./gltfpack.wasm";
                    return path;
                },
                print: (txt) => {
                    const msg = txt.trim();
                    if (msg.match(/compress/i)) {
                        postMessage({ type: "progress", msg, percent: 30 });
                    } else if (msg.match(/quantize/i)) {
                        postMessage({ type: "progress", msg, percent: 50 });
                    } else if (msg.match(/texture|basis|ktx2/i)) {
                        postMessage({ type: "progress", msg, percent: 70 });
                    } else if (msg.match(/done|output/i)) {
                        postMessage({ type: "progress", msg, percent: 100 });
                    } else {
                        postMessage({ type: "log", msg });
                    }
                },
                printErr: (txt) => {
                    // Treat "Warning:" messages as warnings, not errors
                    if (txt.toLowerCase().includes('warning')) {
                        postMessage({ type: "log", msg: `⚠️ ${txt}` });
                    } else {
                        postMessage({ type: "error", msg: txt });
                    }
                }
            });

            // Required for pthread-enabled WASM (spawns worker threads)
            if (gltfpackModule.pthreadPoolSize) {
                postMessage({
                    type: "log",
                    msg: `🧵 gltfpack thread pool: ${gltfpackModule.pthreadPoolSize}`,
                });
            }
        }

        postMessage({ type: "ready" });
        return;
    }

    // Ensure module is initialized
    if (!gltfpackModule) {
        postMessage({ type: "error", msg: "gltfpack not initialized!" });
        return;
    }

    // Run gltfpack job
    if (type === "run") {
        try {
            postMessage({ type: "log", msg: "📝 Writing input file..." });
            gltfpackModule.FS.writeFile("/input.glb", new Uint8Array(data));
            
            postMessage({ type: "log", msg: `🔧 Running gltfpack with args: ${args.join(' ')}` });
            gltfpackModule.callMain(args);
            postMessage({ type: "log", msg: "✅ gltfpack finished" });
            
            // Check if output file exists
            try {
                const stat = gltfpackModule.FS.stat("/output.glb");
                postMessage({ type: "log", msg: `📦 Output file size: ${stat.size} bytes` });
            } catch (statErr) {
                postMessage({ type: "error", msg: "Output file was not created!" });
                return;
            }
            
            const result = gltfpackModule.FS.readFile("/output.glb");
            postMessage({ type: "log", msg: `📤 Sending result (${result.length} bytes)` });
            postMessage({ type: "done", result });
        } catch (err) {
            postMessage({ type: "error", msg: `Worker error: ${err.message || err}` });
        }
    }
};

