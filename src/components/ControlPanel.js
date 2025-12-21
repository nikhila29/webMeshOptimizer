import React, { useState, useRef } from 'react';
import './ControlPanel.css';

function ControlPanel({ 
  stats, 
  hasModel,
  modelFileName,
  wireframeEnabled, 
  onFileUpload, 
  onToggleWireframe,
  onSimplify,
  onExport 
}) {
  const [simplifyValue, setSimplifyValue] = useState(1.0);
  const [textureCompression, setTextureCompression] = useState(true);
  const [textureQuality, setTextureQuality] = useState(5); // 1-10, lower = faster
  const [keepNodeNames, setKeepNodeNames] = useState(false);
  const fileInputRef = useRef(null);

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      onFileUpload(file);
    }
  };

  const handleSimplifyClick = () => {
    if (!hasModel) {
      alert('Load a model first!');
      return;
    }
    onSimplify(simplifyValue, keepNodeNames);
  };

  const handleExportClick = () => {
    if (!hasModel) {
      alert('No model loaded!');
      return;
    }
    onExport({
      textureCompression,
      textureQuality,
      keepNodeNames,
      simplifyValue
    });
  };

  const handleWireframeClick = () => {
    if (!hasModel) {
      alert('No model loaded!');
      return;
    }
    onToggleWireframe();
  };

  return (
    <div className="control-panel">
      <div className="panel-header">
        {/* <div className="panel-icon">◈</div> */}
        <h2>Model Tools</h2>
      </div>

      <div className="panel-section">
        <label className="file-upload-label">
          <input
            ref={fileInputRef}
            type="file"
            accept=".fbx,.obj,.zip,.glb,.gltf"
            onChange={handleFileChange}
            className="file-input"
          />
          <div className="file-upload-button">
            <span className="upload-icon">↑</span>
            <span>Upload Model</span>
          </div>
          <span className="file-hint">.fbx, .obj, .zip, .glb, .gltf</span>
        </label>
        
        {modelFileName && (
          <div className="model-file-info">
            <span className="file-icon">📁</span>
            <span className="file-name" title={modelFileName}>{modelFileName}</span>
          </div>
        )}
      </div>

      <div className="panel-section stats-section">
        <div className="section-title">Statistics</div>
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-label">Vertices</span>
            <span className="stat-value">{stats.vertices.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Triangles</span>
            <span className="stat-value">{stats.triangles.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Draw Calls</span>
            <span className="stat-value">{stats.drawCalls}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">File Size</span>
            <span className="stat-value stat-size">{formatFileSize(stats.fileSize)}</span>
          </div>
          {stats.optimizedSize && (
            <div className="stat-item optimized-stat">
              <span className="stat-label">Preview Size</span>
              <span className="stat-value stat-optimized">
                {formatFileSize(stats.optimizedSize)}
                <span className="size-note">(without texture compression)</span>
              </span>
            </div>
          )}
          {stats.exportedSize && (
            <div className="stat-item exported-stat">
              <span className="stat-label">Exported Size</span>
              <span className="stat-value stat-exported">
                {formatFileSize(stats.exportedSize)}
                {stats.fileSize > 0 && (
                  <span className="size-reduction">
                    ({Math.round((1 - stats.exportedSize / stats.fileSize) * 100)}% smaller)
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="panel-divider"></div>

      <button 
        className={`panel-button ${wireframeEnabled ? 'active' : ''}`}
        onClick={handleWireframeClick}
      >
        {/* <span className="btn-icon">{wireframeEnabled ? '🎨' : '🧩'}</span> */}
        <span>{wireframeEnabled ? 'Shaded View' : 'Mesh View'}</span>
      </button>

      <div className="panel-section">
        <div className="section-title">Options</div>
        
        <label className="checkbox-label">
          <input 
            type="checkbox" 
            checked={textureCompression}
            onChange={(e) => setTextureCompression(e.target.checked)}
          />
          <span className="checkbox-custom"></span>
          <span>Texture Compression</span>
        </label>
        {!textureCompression && (
          <div className="option-hint warning">
            ⚠️ Without TC, file may be larger (textures stored as PNG)
          </div>
        )}

        {textureCompression && (
          <div className="sub-option">
            <div className="slider-header">
              <span>Quality/Speed</span>
              <span className="slider-value">{textureQuality <= 3 ? ' Fast' : textureQuality >= 7 ? ' Best' : ' Balanced'}</span>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={textureQuality}
              onChange={(e) => setTextureQuality(parseInt(e.target.value))}
              className="slider"
            />
            <div className="slider-labels">
              <span>Faster</span>
              <span>Better</span>
            </div>
          </div>
        )}

        <label className="checkbox-label">
          <input 
            type="checkbox" 
            checked={keepNodeNames}
            onChange={(e) => setKeepNodeNames(e.target.checked)}
          />
          <span className="checkbox-custom"></span>
          <span>Keep Node Names</span>
        </label>
      </div>

      <div className="panel-section">
        <div className="slider-header">
          <span>Simplify</span>
          <span className="slider-value">{simplifyValue.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="0.01"
          max="1"
          step="0.01"
          value={simplifyValue}
          onChange={(e) => setSimplifyValue(parseFloat(e.target.value))}
          className="slider"
        />
        <div className="slider-labels">
          <span>Low</span>
          <span>High</span>
        </div>
      </div>

      <div className="button-group">
        <button 
          className="panel-button secondary"
          onClick={handleSimplifyClick}
        >
          {/* <span className="btn-icon">⚡</span> */}
          <span>Simplify Preview</span>
        </button>

        <button 
          className="panel-button primary"
          onClick={handleExportClick}
        >
          <span className="btn-icon">↓</span>
          <span>Export GLB</span>
        </button>
      </div>
    </div>
  );
}

export default ControlPanel;
