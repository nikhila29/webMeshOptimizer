import React, { useRef, useState, useCallback } from 'react';
import ThreeCanvas from './components/ThreeCanvas';
import ControlPanel from './components/ControlPanel';
import LoadingOverlay from './components/LoadingOverlay';
import './App.css';

function App() {
  const threeCanvasRef = useRef(null);
  const [stats, setStats] = useState({ vertices: 0, triangles: 0, drawCalls: 0, fileSize: 0, optimizedSize: null, exportedSize: null });
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Processing...');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStartTime, setLoadingStartTime] = useState(null);
  const [wireframeEnabled, setWireframeEnabled] = useState(false);
  const [hasModel, setHasModel] = useState(false);
  const [modelFileName, setModelFileName] = useState('');

  const handleStatsUpdate = useCallback((newStats) => {
    setStats(prev => ({ ...prev, ...newStats }));
  }, []);

  const handleFileUpload = useCallback(async (file) => {
    if (threeCanvasRef.current) {
      setIsLoading(true);
      setLoadingMessage('Loading model...');
      setLoadingProgress(0);
      setLoadingStartTime(Date.now());
      
      // Store filename and size, clear optimized/exported sizes
      setModelFileName(file.name);
      setStats(prev => ({ ...prev, fileSize: file.size, optimizedSize: null, exportedSize: null }));
      
      try {
        await threeCanvasRef.current.loadModel(file);
        setHasModel(true);
        setLoadingProgress(100);
      } catch (error) {
        console.error('Failed to load model:', error);
        alert('Failed to load model!');
        setModelFileName('');
      } finally {
        setIsLoading(false);
        setLoadingProgress(0);
      }
    }
  }, []);

  const handleToggleWireframe = useCallback(() => {
    if (threeCanvasRef.current) {
      const newState = !wireframeEnabled;
      threeCanvasRef.current.setWireframe(newState);
      setWireframeEnabled(newState);
    }
  }, [wireframeEnabled]);

  const handleSimplify = useCallback(async (simplifyValue, keepNodes) => {
    if (threeCanvasRef.current) {
      setIsLoading(true);
      setLoadingMessage('Simplifying model...');
      setLoadingProgress(0);
      setLoadingStartTime(Date.now());
      try {
        await threeCanvasRef.current.simplifyModel(simplifyValue, keepNodes, (msg, progress) => {
          setLoadingMessage(msg);
          if (progress !== undefined) setLoadingProgress(progress);
        });
        setLoadingProgress(100);
      } catch (error) {
        console.error('Simplify failed:', error);
        alert('Simplify failed — see console for details.');
      } finally {
        setIsLoading(false);
        setLoadingProgress(0);
      }
    }
  }, []);

  const handleExport = useCallback(async (options) => {
    if (threeCanvasRef.current) {
      setIsLoading(true);
      setLoadingMessage('Exporting GLB...');
      setLoadingProgress(0);
      setLoadingStartTime(Date.now());
      try {
        // Pass the filename to export function
        await threeCanvasRef.current.exportGLB({ ...options, fileName: modelFileName }, (msg, progress) => {
          setLoadingMessage(msg);
          if (progress !== undefined) setLoadingProgress(progress);
        });
        setLoadingProgress(100);
      } catch (error) {
        console.error('Export failed:', error);
        alert('Export failed — see console for details.');
      } finally {
        setIsLoading(false);
        setLoadingProgress(0);
      }
    }
  }, [modelFileName]);

  return (
    <div className="app">
      <ThreeCanvas 
        ref={threeCanvasRef} 
        onStatsUpdate={handleStatsUpdate}
      />
      
      <ControlPanel
        stats={stats}
        hasModel={hasModel}
        modelFileName={modelFileName}
        wireframeEnabled={wireframeEnabled}
        onFileUpload={handleFileUpload}
        onToggleWireframe={handleToggleWireframe}
        onSimplify={handleSimplify}
        onExport={handleExport}
      />

      <LoadingOverlay 
        isVisible={isLoading} 
        message={loadingMessage}
        progress={loadingProgress}
        startTime={loadingStartTime}
      />
    </div>
  );
}

export default App;
