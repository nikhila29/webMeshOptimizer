import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import JSZip from 'jszip';

const ThreeCanvas = forwardRef(({ onStatsUpdate }, ref) => {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const currentModelRef = useRef(null);
  const originalModelRef = useRef(null);
  const originalMaterialsRef = useRef(new WeakMap());
  const wireframeEnabledRef = useRef(false);
  const animationIdRef = useRef(null);

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x001F3F);
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 2, 5);
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls setup
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    // Lighting
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    // Animation loop
    let lastStatsUpdate = 0;
    const animate = (time) => {
      animationIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);

      if (currentModelRef.current && time - lastStatsUpdate > 500) {
        updateModelStats(currentModelRef.current);
        lastStatsUpdate = time;
      }
    };
    animate(0);

    // Handle resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      renderer.dispose();
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Update model statistics
  const updateModelStats = useCallback((root, optimizedSize = null, exportedSize = null) => {
    if (!root) return;
    let vertices = 0, triangles = 0, drawCalls = 0;

    root.traverse((obj) => {
      if (obj.isMesh && obj.geometry) {
        const geom = obj.geometry;
        vertices += geom.attributes.position?.count || 0;
        triangles += geom.index 
          ? geom.index.count / 3 
          : (geom.attributes.position?.count || 0) / 3;
        drawCalls++;
      }
    });

    if (onStatsUpdate) {
      const stats = { 
        vertices: Math.round(vertices), 
        triangles: Math.round(triangles), 
        drawCalls 
      };
      // Include optimized size if provided (from simplify preview)
      if (optimizedSize !== null) {
        stats.optimizedSize = optimizedSize;
      }
      // Include exported size if provided (from export)
      if (exportedSize !== null) {
        stats.exportedSize = exportedSize;
      }
      onStatsUpdate(stats);
    }
  }, [onStatsUpdate]);

  // Frame model in view
  const frameModel = useCallback((model) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    const fitOffset = 1.5;

    const fitHeightDistance = size / (2 * Math.atan((Math.PI * camera.fov) / 360));
    const fitWidthDistance = fitHeightDistance / camera.aspect;
    const distance = fitOffset * Math.max(fitHeightDistance, fitWidthDistance);

    controls.maxDistance = distance * 10;
    controls.target.copy(center);
    camera.position.copy(controls.target).add(new THREE.Vector3(0, 0, distance));
    camera.lookAt(center);
    controls.update();
  }, []);

  // Load from ZIP file
  const loadFromZip = async (file) => {
    const zip = await JSZip.loadAsync(file);
    const textureURLs = {};
    let gltfJSON = null;
    let glbBuffer = null;
    let binBuffer = null;
    let fbxBuffer = null;
    let objText = null, mtlText = null;

    // Extract files from ZIP
    for (const name of Object.keys(zip.files)) {
      const lower = name.toLowerCase();

      if (lower.endsWith('.gltf')) {
        gltfJSON = JSON.parse(await zip.files[name].async('text'));
      } else if (lower.endsWith('.glb')) {
        glbBuffer = await zip.files[name].async('arraybuffer');
      } else if (lower.endsWith('.fbx')) {
        fbxBuffer = await zip.files[name].async('arraybuffer');
      } else if (lower.endsWith('.obj')) {
        objText = await zip.files[name].async('text');
      } else if (lower.endsWith('.mtl')) {
        mtlText = await zip.files[name].async('text');
      } else if (lower.endsWith('.bin')) {
        binBuffer = await zip.files[name].async('arraybuffer');
      } else if (/\.(jpg|jpeg|png|tga|webp)$/i.test(lower)) {
        const blob = await zip.files[name].async('blob');
        const url = URL.createObjectURL(blob);
        textureURLs[name.split(/[\\/]/).pop().toLowerCase()] = url;
      }
    }

    // Create URL mapping manager
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      const key = decodeURIComponent(url.split(/[\\/]/).pop().toLowerCase());
      if (textureURLs[key]) return textureURLs[key];
      return url;
    });

    // Handle GLB
    if (glbBuffer) {
      const loader = new GLTFLoader(manager);
      return new Promise((resolve, reject) => {
        loader.parse(glbBuffer, '', (gltf) => resolve(gltf.scene), reject);
      });
    }

    // Handle GLTF (multi-file)
    if (gltfJSON) {
      if (gltfJSON.buffers) {
        for (const buf of gltfJSON.buffers) {
          if (buf.uri && !buf.uri.startsWith('data:')) {
            if (binBuffer) {
              const blob = new Blob([binBuffer], { type: 'application/octet-stream' });
              buf.uri = URL.createObjectURL(blob);
            }
          }
        }
      }

      if (gltfJSON.images) {
        for (const img of gltfJSON.images) {
          if (img.uri && !img.uri.startsWith('data:')) {
            const name = img.uri.split(/[\\/]/).pop().toLowerCase();
            if (textureURLs[name]) {
              img.uri = textureURLs[name];
            }
          }
        }
      }

      const blob = new Blob([JSON.stringify(gltfJSON)], { type: 'model/gltf+json' });
      const url = URL.createObjectURL(blob);

      const loader = new GLTFLoader(manager);
      return new Promise((resolve, reject) => {
        loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
      });
    }

    // Handle FBX
    if (fbxBuffer) {
      const loader = new FBXLoader(manager);
      return loader.parse(fbxBuffer, '');
    }

    // Handle OBJ + MTL
    if (objText) {
      const objLoader = new OBJLoader(manager);
      if (mtlText) {
        const mtlLoader = new MTLLoader(manager);
        const mtl = mtlLoader.parse(mtlText);
        mtl.preload();
        objLoader.setMaterials(mtl);
      }
      return objLoader.parse(objText);
    }

    throw new Error('No supported 3D format found in ZIP');
  };

  // Load model
  const loadModel = async (file) => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (currentModelRef.current) {
      scene.remove(currentModelRef.current);
      currentModelRef.current = null;
    }

    let model;
    const name = file.name.toLowerCase();

    if (name.endsWith('.zip')) {
      model = await loadFromZip(file);
    } else if (name.endsWith('.fbx')) {
      model = new FBXLoader().parse(await file.arrayBuffer(), '');
    } else if (name.endsWith('.obj')) {
      model = new OBJLoader().parse(await file.text());
    } else if (name.endsWith('.glb') || name.endsWith('.gltf')) {
      const arrayBuffer = await file.arrayBuffer();
      const blobURL = URL.createObjectURL(new Blob([arrayBuffer]));
      model = await new Promise((res, rej) => {
        new GLTFLoader().load(blobURL, (gltf) => res(gltf.scene), undefined, rej);
      });
      URL.revokeObjectURL(blobURL);
    } else {
      throw new Error('Unsupported format!');
    }

    model.scale.setScalar(1);
    scene.add(model);
    currentModelRef.current = model;
    originalModelRef.current = model;
    frameModel(model);
    updateModelStats(model);
    console.log('✅ Model loaded:', model);
  };

  // Set wireframe mode
  const setWireframe = (enabled) => {
    const model = currentModelRef.current;
    if (!model) return;

    wireframeEnabledRef.current = enabled;
    
    model.traverse((obj) => {
      if (!obj.isMesh) return;

      if (enabled) {
        if (!originalMaterialsRef.current.has(obj)) {
          originalMaterialsRef.current.set(obj, obj.material);
        }
        const wireMat = obj.material.clone();
        wireMat.wireframe = true;
        wireMat.transparent = true;
        wireMat.opacity = 0.9;
        wireMat.depthTest = true;
        wireMat.needsUpdate = true;
        obj.material = wireMat;
      } else {
        if (originalMaterialsRef.current.has(obj)) {
          obj.material = originalMaterialsRef.current.get(obj);
          obj.material.wireframe = false;
          obj.material.needsUpdate = true;
        }
      }
    });

    updateModelStats(model);
  };

  // Clean attributes
  const cleanAttributes = (object3D) => {
    object3D.traverse((child) => {
      if (child.isMesh && child.geometry) {
        const keep = ['position', 'normal', 'uv', 'uv2', 'color'];
        for (const name in child.geometry.attributes) {
          if (!keep.includes(name.toLowerCase())) {
            child.geometry.deleteAttribute(name);
          }
        }
      }
    });
  };

  // Get texture key for deduplication
  const getTextureKey = (tex) => {
    if (!tex || !tex.image) return null;
    if (tex.image.src) return tex.image.src;
    if (tex.image.currentSrc) return tex.image.currentSrc;
    if (tex.image.width && tex.image.height)
      return `bitmap:${tex.image.width}x${tex.image.height}:${tex.uuid}`;
    if (tex.isDataTexture && tex.image?.data)
      return `data:${tex.image.width}x${tex.image.height}:${tex.uuid}`;
    return tex.uuid;
  };

  // Check if texture is trivial white
  const isTrivialWhiteTexture = (tex) => {
    if (!tex || !tex.image) return true;
    const w = tex.image.width || 0, h = tex.image.height || 0;
    if (w === 1 && h === 1) return true;

    if (tex.isDataTexture && tex.image.data && tex.image.data.length >= 3) {
      const d = tex.image.data;
      const r = d[0], g = d[1], b = d[2], a = d[3] ?? 255;
      return (r === 255 && g === 255 && b === 255 && a === 255);
    }
    return false;
  };

  // Dedupe and prune textures
  const dedupeAndPruneTextures = (root) => {
    const cache = new Map();

    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;

      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];

      for (const mat of materials) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) {
          const stdMat = new THREE.MeshStandardMaterial();
          stdMat.copy(mat);
          obj.material = stdMat;
        }

        const supportedMaps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'];
        for (const key of supportedMaps) {
          const tex = mat[key];
          if (!tex) continue;

          if (isTrivialWhiteTexture(tex)) {
            mat[key] = null;
            continue;
          }

          const k = getTextureKey(tex);
          if (!k) continue;

          if (cache.has(k)) {
            mat[key] = cache.get(k);
          } else {
            cache.set(k, tex);
          }
        }

        if (!mat.emissive) mat.emissive = new THREE.Color(0x000000);

        if (mat.emissive.isColor) {
          const isBlack = mat.emissive.equals(new THREE.Color(0x000000));
          if (mat.emissiveMap && isBlack) {
            mat.emissive.setRGB(1, 1, 1);
          }
        }

        for (const k of Object.keys(mat)) {
          const v = mat[k];
          if (v && v.isTexture && !v.image) {
            mat[k] = null;
          }
        }

        if (mat.metalness === undefined) mat.metalness = 0.5;
        if (mat.roughness === undefined) mat.roughness = 0.5;

        mat.needsUpdate = true;
      }
    });
  };

  // Export to GLB buffer
  const exportGLBBuffer = async (model) => {
    return new Promise((resolve) => {
      new GLTFExporter().parse(
        model,
        (result) => {
          resolve(result instanceof ArrayBuffer ? result : new TextEncoder().encode(JSON.stringify(result)));
        },
        { binary: true, embedImages: true, onlyVisible: true }
      );
    });
  };

  // Run gltfpack in background worker
  const runGltfpackInBackground = async (glbBuffer, args, onProgress) => {
    return new Promise((resolve, reject) => {
      const worker = new Worker(process.env.PUBLIC_URL + '/gltfpack.worker.js');

      worker.postMessage({ type: 'init' });

      worker.onmessage = (e) => {
        const { type, msg, result, percent } = e.data;

        switch (type) {
          case 'ready':
            if (onProgress) onProgress('Initializing gltfpack...', 5);
            worker.postMessage({ type: 'run', data: glbBuffer, args });
            break;
          case 'progress':
            console.log(`⏳ ${percent}% - ${msg}`);
            if (onProgress) onProgress(msg, percent);
            break;
          case 'log':
            console.log('🪶', msg);
            // Parse log messages for progress estimation
            if (msg.includes('Writing input')) {
              if (onProgress) onProgress('Writing input file...', 10);
            } else if (msg.includes('Running gltfpack')) {
              if (onProgress) onProgress('Processing with gltfpack...', 20);
            } else if (msg.includes('gltfpack finished')) {
              if (onProgress) onProgress('gltfpack complete!', 80);
            } else if (msg.includes('Output file')) {
              if (onProgress) onProgress('Reading output...', 90);
            } else if (msg.includes('Sending result')) {
              if (onProgress) onProgress('Finalizing...', 95);
            }
            break;
          case 'error':
            console.error('❌ gltfpack error:', msg);
            reject(new Error(msg));
            break;
          case 'done':
            worker.terminate();
            if (onProgress) onProgress('Complete!', 100);
            resolve(result.buffer);
            break;
          default:
            break;
        }
      };
    });
  };

  // Simplify model
  const simplifyModel = async (simplifyValue, keepNodes, onProgress) => {
    const originalModel = originalModelRef.current;
    if (!originalModel) throw new Error('No model loaded!');

    if (onProgress) onProgress('Preparing model...', 5);

    const wasWireframe = wireframeEnabledRef.current;
    if (wasWireframe) setWireframe(false);

    cleanAttributes(originalModel);
    dedupeAndPruneTextures(originalModel);

    const args = ['-i', '/input.glb', '-o', '/output.glb', '-si', simplifyValue.toString()];
    if (keepNodes) args.push('-kn');
    args.push('-vpf');

    console.log('🚀 Running simplify in background:', args);

    if (onProgress) onProgress('Exporting to GLB buffer...', 10);
    const glbBuffer = await exportGLBBuffer(originalModel);
    
    const optimized = await runGltfpackInBackground(glbBuffer, args, onProgress);

    if (onProgress) onProgress('Loading simplified model...', 95);
    const blob = new Blob([optimized], { type: 'model/gltf-binary' });
    const optimizedSize = optimized.byteLength || optimized.length;
    const url = URL.createObjectURL(blob);
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);

    const scene = sceneRef.current;
    scene.remove(currentModelRef.current);
    currentModelRef.current = gltf.scene;
    scene.add(currentModelRef.current);
    
    // Pass optimized size to stats update
    updateModelStats(currentModelRef.current, optimizedSize);
    if (wasWireframe) setWireframe(true);
    
    if (onProgress) onProgress('Complete!', 100);
    console.log(`✅ Simplified preview loaded (${(optimizedSize / 1024 / 1024).toFixed(2)} MB)`);
    URL.revokeObjectURL(url);
  };

  // Export GLB
  const exportGLB = async (options, onProgress) => {
    // Use current model (may already be simplified) instead of original
    const modelToExport = currentModelRef.current;
    if (!modelToExport) throw new Error('No model loaded!');

    if (onProgress) onProgress('Preparing model...', 5);

    const startTime = performance.now();

    cleanAttributes(modelToExport);
    dedupeAndPruneTextures(modelToExport);

    const args = ['-i', '/input.glb', '-o', '/output.glb'];

    if (options.textureCompression) {
      args.push('-tc');
      // Use all available CPU cores for parallel texture compression
      const threadCount = navigator.hardwareConcurrency || 4;
      args.push('-tj', threadCount.toString());
      // Texture quality (1-10): lower = faster compression, higher = better quality
      const quality = options.textureQuality || 5;
      args.push('-tq', quality.toString());
      console.log(`🧵 Using ${threadCount} threads for texture compression (quality: ${quality})`);
    } else {
      // Without texture compression, textures stay as PNG/JPEG
      // Add mesh compression to at least reduce geometry size
      args.push('-c'); // Enable mesh compression (Draco-like)
    }
    
    if (options.keepNodeNames) {
      args.push('-kn');
    } else {
      args.push('-mm');
      args.push('-mi');
    }

    // Quantization and optimization
    args.push('-vpf'); // Vertex position format
    args.push('-cc'); // Compress vertex colors

    // Skip simplification if model was already simplified (currentModel !== originalModel)
    const isAlreadySimplified = currentModelRef.current !== originalModelRef.current;
    if (options.simplifyValue < 1.0 && !isAlreadySimplified) {
      args.push('-si', options.simplifyValue.toString());
    }

    console.log('🚀 Exporting with args:', args, isAlreadySimplified ? '(using pre-simplified model)' : '');

    if (onProgress) onProgress('Exporting to GLB buffer...', 10);
    const glbBuffer = await exportGLBBuffer(modelToExport);
    
    const optimizeStart = performance.now();
    const optimized = await runGltfpackInBackground(glbBuffer, args, onProgress);
    const optimizeEnd = performance.now();

    console.log(`⚙️ gltfpack optimization time: ${(optimizeEnd - optimizeStart).toFixed(2)} ms`);

    if (onProgress) onProgress('Downloading file...', 92);
    // Download file with original name + _optimized
    const blob = new Blob([optimized], { type: 'model/gltf-binary' });
    const exportedSize = optimized.byteLength || optimized.length;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Generate filename: originalname_optimized.glb
    let exportFileName = 'optimized.glb';
    if (options.fileName) {
      const baseName = options.fileName.replace(/\.[^/.]+$/, ''); // Remove extension
      exportFileName = `${baseName}_optimized.glb`;
    }
    a.download = exportFileName;
    a.click();
    
    console.log(`📥 Downloaded: ${exportFileName} (${(exportedSize / 1024).toFixed(1)} KB)`);

    if (onProgress) onProgress('Loading preview...', 95);
    // Load preview
    const loader = new GLTFLoader();
    if (options.textureCompression) {
      const { KTX2Loader } = await import('three/examples/jsm/loaders/KTX2Loader.js');
      const ktx2Loader = new KTX2Loader()
        .setTranscoderPath('https://unpkg.com/three@0.165.0/examples/jsm/libs/basis/')
        .detectSupport(rendererRef.current);
      loader.setKTX2Loader(ktx2Loader);
    }

    const gltf = await loader.loadAsync(url);
    const scene = sceneRef.current;
    if (currentModelRef.current) scene.remove(currentModelRef.current);
    currentModelRef.current = gltf.scene;
    scene.add(currentModelRef.current);
    frameModel(currentModelRef.current);
    
    // Pass null for optimizedSize (preview), but pass exportedSize
    updateModelStats(currentModelRef.current, null, exportedSize);

    const endTime = performance.now();
    const totalSeconds = ((endTime - startTime) / 1000).toFixed(2);
    if (onProgress) onProgress(`Export complete in ${totalSeconds}s`, 100);
    console.log(`✅ Export complete in ${totalSeconds}s (${(exportedSize / 1024).toFixed(1)} KB)`);

    URL.revokeObjectURL(url);
  };

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    loadModel,
    setWireframe,
    simplifyModel,
    exportGLB
  }));

  return <div ref={containerRef} className="canvas-container" />;
});

export default ThreeCanvas;

