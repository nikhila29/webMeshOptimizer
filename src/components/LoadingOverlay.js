import React, { useState, useEffect, useRef } from 'react';
import './LoadingOverlay.css';

function LoadingOverlay({ isVisible, message, progress, startTime }) {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [estimatedTimeLeft, setEstimatedTimeLeft] = useState(null);
  const progressHistoryRef = useRef([]);

  useEffect(() => {
    if (!isVisible || !startTime) {
      setElapsedTime(0);
      setEstimatedTimeLeft(null);
      progressHistoryRef.current = [];
      return;
    }

    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setElapsedTime(Math.floor(elapsed));

      // Calculate ETA based on progress rate
      if (progress > 0 && progress < 100) {
        // Add to progress history
        progressHistoryRef.current.push({ time: elapsed, progress });
        
        // Keep last 10 data points for smoothing
        if (progressHistoryRef.current.length > 10) {
          progressHistoryRef.current.shift();
        }

        // Calculate average rate from history
        if (progressHistoryRef.current.length >= 2) {
          const first = progressHistoryRef.current[0];
          const last = progressHistoryRef.current[progressHistoryRef.current.length - 1];
          const progressDelta = last.progress - first.progress;
          const timeDelta = last.time - first.time;

          if (progressDelta > 0 && timeDelta > 0) {
            const rate = progressDelta / timeDelta; // percent per second
            const remainingProgress = 100 - progress;
            const estimatedSeconds = remainingProgress / rate;
            
            // Cap at reasonable values (max 1 hour)
            if (estimatedSeconds > 0 && estimatedSeconds < 3600) {
              setEstimatedTimeLeft(Math.ceil(estimatedSeconds));
            } else if (estimatedSeconds >= 3600) {
              setEstimatedTimeLeft(3600); // Show "60m+" for very long operations
            }
          }
        }
      } else if (progress >= 100) {
        setEstimatedTimeLeft(0);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isVisible, startTime, progress]);

  // Reset history when progress resets
  useEffect(() => {
    if (progress === 0) {
      progressHistoryRef.current = [];
      setEstimatedTimeLeft(null);
    }
  }, [progress]);

  if (!isVisible) return null;

  const formatTime = (seconds) => {
    if (seconds === null || seconds === undefined) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    return `0:${secs.toString().padStart(2, '0')}`;
  };

  const formatTimeLeft = (seconds) => {
    if (seconds === null || seconds === undefined) return 'Calculating...';
    if (seconds === 0) return 'Complete!';
    if (seconds >= 3600) return '60m+ left';
    
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s left`;
    }
    return `${secs}s left`;
  };

  const progressPercent = progress || 0;

  return (
    <div className="loading-overlay">
      <div className="loading-content">
        <div className="loading-spinner">
          <div className="spinner-ring"></div>
          <div className="spinner-ring"></div>
          <div className="spinner-ring"></div>
        </div>
        
        <span className="loading-text">{message}</span>
        
        <div className="progress-container">
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          
          <div className="progress-info">
            <span className="progress-percent">{Math.round(progressPercent)}%</span>
            <span className="progress-eta">{formatTimeLeft(estimatedTimeLeft)}</span>
          </div>
          
          <div className="time-info">
            <span className="elapsed-label">Elapsed:</span>
            <span className="elapsed-time">{formatTime(elapsedTime)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoadingOverlay;
