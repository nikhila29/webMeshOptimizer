import React, { useRef, useState, useCallback, useEffect } from "react";
import "./Style.scss";
import ThreeCanvas from "./ThreeCanvas";
import ControlPanel from "./ControlPanel";
import LoadingOverlay from "./LoadingOverlay";
import { useAlert } from "../../../utils/alertContext";

const WebMeshOptimizer = ({
	initialFile = null,
	onClose = null,
	onExportComplete = null,
	isPopup = false,
	existingFileNames = [],
}) => {
	const { showAlert } = useAlert();
	const threeCanvasRef = useRef(null);
	const abortControllerRef = useRef(null);
	const [stats, setStats] = useState({
		vertices: 0,
		triangles: 0,
		drawCalls: 0,
		fileSize: 0,
		optimizedSize: null,
		exportedSize: null,
	});
	const [isLoading, setIsLoading] = useState(false);
	const [loadingMessage, setLoadingMessage] = useState("Processing...");
	const [loadingProgress, setLoadingProgress] = useState(0);
	const [loadingStartTime, setLoadingStartTime] = useState(null);
	const [wireframeEnabled, setWireframeEnabled] = useState(false);
	const [hasModel, setHasModel] = useState(false);
	const [modelFileName, setModelFileName] = useState("");
	// Track background color (hex string)
	const [backgroundColor, setBackgroundColor] = useState("#ffffff");
	// Track current operation type: 'loading' | 'processing' | 'uploading' | null
	const [currentOperation, setCurrentOperation] = useState(null);
	// Track if model has pre-compressed textures (KTX2/Basis)
	const [hasCompressedTextures, setHasCompressedTextures] = useState(false);
	// Track if model has any textures at all
	const [modelHasTextures, setModelHasTextures] = useState(true);

	// Handle cancel/close of loading overlay
	// - For 'loading' (initial model load): go back to upload content page
	// - For 'processing'/'uploading' (gltfpack): stay on mesh optimizer
	const handleLoadingClose = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
		}

		// Dispose KTX2 loader workers to free memory
		if (threeCanvasRef.current && threeCanvasRef.current.disposeKTX2Loader) {
			threeCanvasRef.current.disposeKTX2Loader();
		}

		const shouldClosePopup = currentOperation === "loading";

		setIsLoading(false);
		setLoadingProgress(0);
		setCurrentOperation(null);

		// Only close popup and go back to upload for initial model loading
		if (shouldClosePopup && onClose) {
			onClose();
		}
	}, [onClose, currentOperation]);

	// Auto-load initial file when provided (for popup mode)
	useEffect(() => {
		if (initialFile && threeCanvasRef.current) {
			handleFileUpload(initialFile);
		}
	}, [initialFile]);

	const handleStatsUpdate = useCallback((newStats) => {
		setStats((prev) => ({ ...prev, ...newStats }));
	}, []);

	// Handle texture compression detection from ThreeCanvas
	const handleTextureCompressionDetected = useCallback((hasCompressed) => {
		setHasCompressedTextures(hasCompressed);
	}, []);

	// Handle model texture detection from ThreeCanvas
	const handleModelHasTextures = useCallback((hasTextures) => {
		setModelHasTextures(hasTextures);
	}, []);

	const handleFileUpload = useCallback(async (file) => {
		if (threeCanvasRef.current) {
			// Create abort controller for this operation
			abortControllerRef.current = new AbortController();
			const signal = abortControllerRef.current.signal;

			setCurrentOperation("loading");
			setIsLoading(true);
			setLoadingMessage("Loading model...");
			setLoadingProgress(0);
			setLoadingStartTime(Date.now());

			// Store filename and size, clear optimized/exported sizes
			setModelFileName(file.name);
			setHasCompressedTextures(false); // Reset compressed texture flag for new file
			setModelHasTextures(true); // Reset texture flag for new file (will be updated after load)
			setStats((prev) => ({
				...prev,
				fileSize: file.size,
				optimizedSize: null,
				exportedSize: null,
			}));

			try {
				await threeCanvasRef.current.loadModel(file, signal);
				// Check if aborted before updating state
				if (signal.aborted) {
					setModelFileName("");
					return;
				}
				setHasModel(true);
				setLoadingProgress(100);
			} catch (error) {
				if (error.name === "AbortError" || signal.aborted) {
					console.log("Model loading cancelled");
					setModelFileName("");
					return;
				}
				console.error("Failed to load model:", error);
				// alert("Failed to load model!");
				showAlert({
					message: error.message || "Failed to load model!",
					onClickSecondaryBtn: () => {
						// Close the WebMeshOptimizer tool after clicking OK
						if (onClose) {
							onClose();
						}
					},
				});
				setModelFileName("");
			} finally {
				abortControllerRef.current = null;
				setIsLoading(false);
				setLoadingProgress(0);
				setCurrentOperation(null);
			}
		}
	}, [onClose]);

	const handleToggleWireframe = useCallback(() => {
		if (threeCanvasRef.current) {
			const newState = !wireframeEnabled;
			threeCanvasRef.current.setWireframe(newState);
			setWireframeEnabled(newState);
		}
	}, [wireframeEnabled]);

	const handleBackgroundColorChange = useCallback((color) => {
		if (threeCanvasRef.current) {
			threeCanvasRef.current.setBackgroundColor(color);
			setBackgroundColor(color);
		}
	}, []);

	const handleSimplify = useCallback(async (simplifyValue, keepNodes) => {
		if (threeCanvasRef.current) {
			// Create abort controller for this operation
			abortControllerRef.current = new AbortController();
			const signal = abortControllerRef.current.signal;

			setCurrentOperation("processing");
			setIsLoading(true);
			setLoadingMessage("Simplifying model...");
			setLoadingProgress(0);
			setLoadingStartTime(Date.now());
			try {
				await threeCanvasRef.current.simplifyModel(
					simplifyValue,
					keepNodes,
					(msg, progress) => {
						if (signal.aborted) return;
						setLoadingMessage(msg);
						if (progress !== undefined) setLoadingProgress(progress);
					},
					signal
				);
				if (signal.aborted) return;
				setLoadingProgress(100);
			} catch (error) {
				if (error.name === "AbortError" || signal.aborted) {
					console.log("Simplify cancelled");
					return;
				}
				console.error("Simplify failed:", error);
				// alert("Simplify failed — see console for details.");
				showAlert({
					toast: true,
					error: true,
					message: "Simplify failed — see console for details.",
				});
			} finally {
				abortControllerRef.current = null;
				setIsLoading(false);
				setLoadingProgress(0);
				setCurrentOperation(null);
			}
		}
	}, []);

	// Shared export/download handler
	const handleExportOrDownload = useCallback(
		async (options, isUploadMode = false) => {
			if (!threeCanvasRef.current || (isUploadMode && !onExportComplete)) return;

			// Create abort controller for this operation
			abortControllerRef.current = new AbortController();
			const signal = abortControllerRef.current.signal;

			const actionType = isUploadMode ? "Uploading" : "Downloading";
			setCurrentOperation(isUploadMode ? "uploading" : "processing");
			setIsLoading(true);
			setLoadingMessage(`Optimizing & ${actionType}...`);
			setLoadingProgress(0);
			setLoadingStartTime(Date.now());

			try {
				const exportOptions = {
					...options,
					fileName: modelFileName,
					signal,
					...(isUploadMode && {
						existingFileNames,
						onExportComplete: (blob, fileName, size, screenshot) => {
							console.log(`onExportComplete callback called, signal.aborted=${signal.aborted}`);
							if (signal.aborted) {
								console.log(` Upload skipped - signal was aborted`);
								return;
							}
							console.log(` Export complete, uploading ${fileName} (${(size / 1024).toFixed(1)} KB)`);
							if (screenshot) {
								console.log(` Screenshot included: ${screenshot.width}x${screenshot.height} (${(screenshot.size / 1024).toFixed(1)} KB)`);
							}
							// Pass blob, fileName, size, and screenshot to parent
							onExportComplete(blob, fileName, size, screenshot);
						},
					}),
				};

				await threeCanvasRef.current.exportGLB(exportOptions, (msg, progress) => {
					if (signal.aborted) return;
					setLoadingMessage(msg);
					if (progress !== undefined) setLoadingProgress(progress);
				});
				if (signal.aborted) return;
				setLoadingProgress(100);
			} catch (error) {
				if (error.name === "AbortError" || signal.aborted) {
					console.log(`${actionType} cancelled`);
					return;
				}
				console.error(`${actionType} failed:`, error);
				// alert(`${actionType} failed — see console for details.`);
				showAlert({
					toast: true,
					error: true,
					message: `${actionType} failed — see console for details.`,
				});
			} finally {
				abortControllerRef.current = null;
				setIsLoading(false);
				setLoadingProgress(0);
				setCurrentOperation(null);
			}
		},
		[modelFileName, onExportComplete, existingFileNames]
	);

	// Handle export for popup mode (upload to Azure/DB)
	const handleExport = useCallback(
		(options) => handleExportOrDownload(options, true),
		[handleExportOrDownload]
	);

	// Handle download for standalone mode
	const handleDownload = useCallback(
		(options) => handleExportOrDownload(options, false),
		[handleExportOrDownload]
	);

	return (
		<div className={`web-mesh-optimizer ${isPopup ? "popup-mode" : ""}`}>
			{/* Close button for popup mode */}
			{isPopup && onClose && (
				<button className="wmo-close-btn" onClick={onClose} title="Close">
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
						<path
							d="M18 6L6 18M6 6L18 18"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</button>
			)}

			<ThreeCanvas
				ref={threeCanvasRef}
				onStatsUpdate={handleStatsUpdate}
				onTextureCompressionDetected={handleTextureCompressionDetected}
				onModelHasTextures={handleModelHasTextures}
			/>

			<ControlPanel
				stats={stats}
				hasModel={hasModel}
				modelFileName={modelFileName}
				wireframeEnabled={wireframeEnabled}
				backgroundColor={backgroundColor}
				onFileUpload={!isPopup ? handleFileUpload : null}
				onToggleWireframe={handleToggleWireframe}
				onBackgroundColorChange={handleBackgroundColorChange}
				onSimplify={handleSimplify}
				onExport={handleExport}
				onDownload={handleDownload}
				isPopup={isPopup}
				hasCompressedTextures={hasCompressedTextures}
				modelHasTextures={modelHasTextures}
			/>

			<LoadingOverlay
				isVisible={isLoading}
				message={loadingMessage}
				progress={loadingProgress}
				startTime={loadingStartTime}
				onClose={handleLoadingClose}
			/>
		</div>
	);
};

export default WebMeshOptimizer;
