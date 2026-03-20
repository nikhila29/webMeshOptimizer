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

//future purpose
// import React, {
// 	useRef,
// 	useEffect,
// 	useImperativeHandle,
// 	forwardRef,
// 	useCallback,
// } from "react";
// import * as THREE from "three";
// import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
// import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
// import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
// import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
// import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
// import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
// import JSZip from "jszip";
// import { useAlert } from "../../../utils/alertContext";

// const ThreeCanvas = forwardRef(({ onStatsUpdate, onTextureCompressionDetected, onModelHasTextures }, ref) => {
// 	const containerRef = useRef(null);
// 	const sceneRef = useRef(null);
// 	const cameraRef = useRef(null);
// 	const rendererRef = useRef(null);
// 	const controlsRef = useRef(null);
// 	const currentModelRef = useRef(null);
// 	const originalModelRef = useRef(null);
// 	const originalMaterialsRef = useRef(new WeakMap());
// 	const wireframeEnabledRef = useRef(false);
// 	const animationIdRef = useRef(null);
// 	const originalFileBufferRef = useRef(null); // Store original file buffer for simplification
// 	const simplifiedBufferRef = useRef(null); // Store simplified buffer after simplification
// 	const hasCompressedTexturesRef = useRef(false); // Track if model has KTX2/Basis textures
// 	const modelHasTexturesRef = useRef(true); // Track if model has any textures at all
// 	const originalModelScaleRef = useRef(1); // Store original model scale factor
// 	const modelFileTypeRef = useRef(null); // Track file type ('fbx', 'glb', 'gltf', 'obj', 'zip')
// 	const ktx2LoaderRef = useRef(null); // Tracks active KTX2Loader so we can dispose its workers
// 	const { showAlert } = useAlert();

// 	// Get or create a shared KTX2Loader (reuses existing instance to avoid spawning duplicate workers).
// 	const getKTX2Loader = useCallback(async () => {
// 		// Reuse existing loader if available
// 		if (ktx2LoaderRef.current) {
// 			return ktx2LoaderRef.current;
// 		}
// 		const { KTX2Loader } = await import(
// 			"three/examples/jsm/loaders/KTX2Loader.js"
// 		);
// 		const ktx2Loader = new KTX2Loader()
// 			.setTranscoderPath(
// 				"https://unpkg.com/three@0.165.0/examples/jsm/libs/basis/"
// 			)
// 			.detectSupport(rendererRef.current);
// 		ktx2LoaderRef.current = ktx2Loader;
// 		return ktx2Loader;
// 	}, []);

// 	// Terminate KTX2 worker threads - only call on unmount or explicit cleanup.
// 	const disposeKTX2Loader = useCallback(() => {
// 		if (ktx2LoaderRef.current) {
// 			ktx2LoaderRef.current.dispose();
// 			ktx2LoaderRef.current = null;
// 		}
// 	}, []);

// 	// Initialize Three.js scene
// 	useEffect(() => {
// 		if (!containerRef.current) return;

// 		// Scene setup
// 		const scene = new THREE.Scene();
// 		scene.background = new THREE.Color(0xffffff);
// 		sceneRef.current = scene;

// 		// Use container dimensions instead of window for proper sizing in popup mode
// 		const containerWidth = containerRef.current.clientWidth || window.innerWidth;
// 		const containerHeight = containerRef.current.clientHeight || window.innerHeight;

// 		// Camera setup
// 		const camera = new THREE.PerspectiveCamera(
// 			60,
// 			containerWidth / containerHeight,
// 			0.1,
// 			10000
// 		);
// 		camera.position.set(0, 2, 5);
// 		cameraRef.current = camera;

// 		// Renderer setup - preserveDrawingBuffer needed for screenshot capture
// 		const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
// 		renderer.setSize(containerWidth, containerHeight);
// 		renderer.outputColorSpace = THREE.SRGBColorSpace;
// 		containerRef.current.appendChild(renderer.domElement);
// 		rendererRef.current = renderer;

// 		// Controls setup
// 		const controls = new OrbitControls(camera, renderer.domElement);
// 		controls.enableDamping = true;
// 		controlsRef.current = controls;

// 		// Lighting
// 		scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));
// 		const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
// 		directionalLight.position.set(5, 10, 7.5);
// 		scene.add(directionalLight);
// 		scene.add(new THREE.AmbientLight(0xffffff, 0.5));

// 		// Animation loop
// 		let lastStatsUpdate = 0;
// 		const animate = (time) => {
// 			animationIdRef.current = requestAnimationFrame(animate);
// 			controls.update();
// 			renderer.render(scene, camera);

// 			if (currentModelRef.current && time - lastStatsUpdate > 500) {
// 				updateModelStats(currentModelRef.current);
// 				lastStatsUpdate = time;
// 			}
// 		};
// 		animate(0);

// 		// Handle resize - use ResizeObserver for container size changes (e.g., modal animations)
// 		const container = containerRef.current;
// 		const handleResize = () => {
// 			const w = container.clientWidth || window.innerWidth;
// 			const h = container.clientHeight || window.innerHeight;
// 			if (w > 0 && h > 0) {
// 				camera.aspect = w / h;
// 				camera.updateProjectionMatrix();
// 				renderer.setSize(w, h);
// 			}
// 		};
// 		window.addEventListener("resize", handleResize);

// 		// ResizeObserver catches container size changes from CSS animations, modal open, etc.
// 		let resizeObserver;
// 		if (typeof ResizeObserver !== "undefined") {
// 			resizeObserver = new ResizeObserver(handleResize);
// 			resizeObserver.observe(container);
// 		}

// 		// Cleanup
// 		return () => {
// 			window.removeEventListener("resize", handleResize);
// 			if (resizeObserver) {
// 				resizeObserver.disconnect();
// 			}
// 			if (animationIdRef.current) {
// 				cancelAnimationFrame(animationIdRef.current);
// 			}
// 			// Dispose model geometry, materials, and textures to free GPU memory
// 			if (currentModelRef.current) {
// 				scene.remove(currentModelRef.current);
// 				currentModelRef.current.traverse((child) => {
// 					if (child.isMesh) {
// 						if (child.geometry) child.geometry.dispose();
// 						const mats = Array.isArray(child.material) ? child.material : [child.material];
// 						mats.forEach((m) => {
// 							if (!m) return;
// 							for (const key of Object.keys(m)) {
// 								if (m[key] && m[key].isTexture) m[key].dispose();
// 							}
// 							m.dispose();
// 						});
// 					}
// 				});
// 				currentModelRef.current = null;
// 			}
// 			originalModelRef.current = null;
// 			originalFileBufferRef.current = null;
// 			simplifiedBufferRef.current = null;
// 			// Dispose the shared KTX2Loader to terminate its worker threads
// 			if (ktx2LoaderRef.current) {
// 				ktx2LoaderRef.current.dispose();
// 				ktx2LoaderRef.current = null;
// 			}
// 			renderer.dispose();
// 			if (containerRef.current && renderer.domElement) {
// 				containerRef.current.removeChild(renderer.domElement);
// 			}
// 		};
// 	}, []);

// 	// Update model statistics
// 	const updateModelStats = useCallback(
// 		(root, optimizedSize = null, exportedSize = null) => {
// 			if (!root) return;
// 			let vertices = 0,
// 				triangles = 0,
// 				drawCalls = 0;

// 			root.traverse((obj) => {
// 				if (obj.isMesh && obj.geometry) {
// 					const geom = obj.geometry;
// 					vertices += geom.attributes.position?.count || 0;
// 					triangles += geom.index
// 						? geom.index.count / 3
// 						: (geom.attributes.position?.count || 0) / 3;
// 					drawCalls++;
// 				}
// 			});

// 			if (onStatsUpdate) {
// 				const stats = {
// 					vertices: Math.round(vertices),
// 					triangles: Math.round(triangles),
// 					drawCalls,
// 				};
// 				// Include optimized size if provided (from simplify preview)
// 				if (optimizedSize !== null) {
// 					stats.optimizedSize = optimizedSize;
// 				}
// 				// Include exported size if provided (from export)
// 				if (exportedSize !== null) {
// 					stats.exportedSize = exportedSize;
// 				}
// 				onStatsUpdate(stats);
// 			}
// 		},
// 		[onStatsUpdate]
// 	);

// 	// Frame model in view
// 	const frameModel = useCallback((model) => {
// 		const camera = cameraRef.current;
// 		const controls = controlsRef.current;
// 		if (!camera || !controls) return;

// 		const box = new THREE.Box3().setFromObject(model);
// 		const size = box.getSize(new THREE.Vector3()).length();
// 		const center = box.getCenter(new THREE.Vector3());

// 		// Guard against empty/degenerate bounding boxes
// 		if (!size || !isFinite(size) || size === 0) {
// 			console.warn("Model has empty bounding box, using defaults");
// 			return;
// 		}

// 		const fitOffset = 1.5;

// 		const fitHeightDistance =
// 			size / (2 * Math.atan((Math.PI * camera.fov) / 360));
// 		const fitWidthDistance = fitHeightDistance / camera.aspect;
// 		const distance = fitOffset * Math.max(fitHeightDistance, fitWidthDistance);

// 		// Adjust near/far clipping planes based on model size to prevent clipping
// 		camera.near = Math.max(0.01, distance * 0.001);
// 		camera.far = Math.max(1000, distance * 20);
// 		camera.updateProjectionMatrix();

// 		controls.maxDistance = distance * 10;
// 		controls.target.copy(center);
// 		camera.position
// 			.copy(controls.target)
// 			.add(new THREE.Vector3(0, 0, distance));
// 		camera.lookAt(center);
// 		controls.update();
// 	}, []);

// 	// Load from ZIP file
// 	const loadFromZip = async (file) => {
// 		const zip = await JSZip.loadAsync(file);
// 		const textureURLs = {};
// 		let gltfJSON = null;
// 		let glbBuffer = null;
// 		let binBuffer = null;
// 		let fbxBuffer = null;
// 		let objText = null,
// 			mtlText = null;
// 		const unsupportedTextures = [];

// 		// Extract files from ZIP
// 		for (const name of Object.keys(zip.files)) {
// 			const lower = name.toLowerCase();

// 			if (lower.endsWith(".gltf")) {
// 				gltfJSON = JSON.parse(await zip.files[name].async("text"));
// 			} else if (lower.endsWith(".glb")) {
// 				glbBuffer = await zip.files[name].async("arraybuffer");
// 			} else if (lower.endsWith(".fbx")) {
// 				fbxBuffer = await zip.files[name].async("arraybuffer");
// 			} else if (lower.endsWith(".obj")) {
// 				objText = await zip.files[name].async("text");
// 			} else if (lower.endsWith(".mtl")) {
// 				mtlText = await zip.files[name].async("text");
// 			} else if (lower.endsWith(".bin")) {
// 				binBuffer = await zip.files[name].async("arraybuffer");
// 			} else if (/\.(jpg|jpeg|png|ktx2)$/i.test(lower)) {
// 				// Only upload jpg, png, ktx2 textures - other formats like tga, webp are not supported
// 				const blob = await zip.files[name].async("blob");
// 				const url = URL.createObjectURL(blob);
// 				textureURLs[name.split(/[\\/]/).pop().toLowerCase()] = url;
// 			} else if (/\.(tga|webp|bmp|gif|tiff?|exr|hdr|dds|psd)$/i.test(lower)) {
// 				// Detect unsupported texture formats
// 				unsupportedTextures.push(name.split(/[\\/]/).pop());
// 			}
// 		}

// 		// Throw error if unsupported textures are found
// 		if (unsupportedTextures.length > 0) {
// 			throw new Error(`Unsupported texture format(s) detected: ${unsupportedTextures.join(', ')}. Only JPG, PNG, and KTX2 textures are supported.`);
// 		}

// 		// Create URL mapping manager
// 		const manager = new THREE.LoadingManager();
// 		manager.setURLModifier((url) => {
// 			const key = decodeURIComponent(url.split(/[\\/]/).pop().toLowerCase());
// 			if (textureURLs[key]) return textureURLs[key];
// 			return url;
// 		});

// 		// Handle GLB
// 		if (glbBuffer) {
// 			const loader = new GLTFLoader(manager);
// 			return new Promise((resolve, reject) => {
// 				loader.parse(glbBuffer, "", (gltf) => resolve(gltf.scene), reject);
// 			});
// 		}

// 		// Handle GLTF (multi-file)
// 		if (gltfJSON) {
// 			if (gltfJSON.buffers) {
// 				for (const buf of gltfJSON.buffers) {
// 					if (buf.uri && !buf.uri.startsWith("data:")) {
// 						if (binBuffer) {
// 							const blob = new Blob([binBuffer], {
// 								type: "application/octet-stream",
// 							});
// 							buf.uri = URL.createObjectURL(blob);
// 						}
// 					}
// 				}
// 			}

// 			if (gltfJSON.images) {
// 				for (const img of gltfJSON.images) {
// 					if (img.uri && !img.uri.startsWith("data:")) {
// 						const name = img.uri.split(/[\\/]/).pop().toLowerCase();
// 						if (textureURLs[name]) {
// 							img.uri = textureURLs[name];
// 						}
// 					}
// 				}
// 			}

// 			const blob = new Blob([JSON.stringify(gltfJSON)], {
// 				type: "model/gltf+json",
// 			});
// 			const url = URL.createObjectURL(blob);

// 			const loader = new GLTFLoader(manager);
// 			return new Promise((resolve, reject) => {
// 				loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
// 			});
// 		}

// 		// Handle FBX
// 		if (fbxBuffer) {
// 			const loader = new FBXLoader(manager);
// 			return loader.parse(fbxBuffer, "");
// 		}

// 		// Handle OBJ + MTL
// 		if (objText) {
// 			const objLoader = new OBJLoader(manager);
// 			if (mtlText) {
// 				const mtlLoader = new MTLLoader(manager);
// 				const mtl = mtlLoader.parse(mtlText);
// 				mtl.preload();
// 				objLoader.setMaterials(mtl);
// 			}
// 			return objLoader.parse(objText);
// 		}

// 		throw new Error("No supported 3D format found in ZIP");
// 	};

// 	// Dispose Three.js object tree (geometry, materials, textures) to free GPU memory
// 	const disposeObject = useCallback((obj) => {
// 		if (!obj) return;
// 		obj.traverse((child) => {
// 			if (child.isMesh) {
// 				if (child.geometry) child.geometry.dispose();
// 				const materials = Array.isArray(child.material) ? child.material : [child.material];
// 				materials.forEach((mat) => {
// 					if (!mat) return;
// 					// Dispose all texture maps
// 					for (const key of Object.keys(mat)) {
// 						const value = mat[key];
// 						if (value && value.isTexture) {
// 							value.dispose();
// 						}
// 					}
// 					mat.dispose();
// 				});
// 			}
// 		});
// 	}, []);

// 	// Load model
// 	const loadModel = async (file, signal) => {
// 		const scene = sceneRef.current;
// 		if (!scene) return;
// 		// Clear previous model and free GPU resources
// 		if (currentModelRef.current) {
// 			scene.remove(currentModelRef.current);
// 			disposeObject(currentModelRef.current);
// 			currentModelRef.current = null;
// 		}
// 		if (originalModelRef.current && originalModelRef.current !== currentModelRef.current) {
// 			disposeObject(originalModelRef.current);
// 			originalModelRef.current = null;
// 		}
// 		simplifiedBufferRef.current = null;
// 		originalFileBufferRef.current = null;
// 		let model;
// 		const name = file.name.toLowerCase();
// 		let fileType = null;
// 		let modelScale = 1; // Default scale

// 		if (name.endsWith(".zip")) {
// 			model = await loadFromZip(file);
// 			fileType = 'zip';
// 			modelScale = 0.01; // ZIP files (containing FBX/OBJ) typically need scaling
// 		} else if (name.endsWith(".fbx")) {
// 			const arrayBuffer = await file.arrayBuffer();
// 			const blobURL = URL.createObjectURL(new Blob([arrayBuffer]));
		
// 			const loader = new FBXLoader();
		
// 			model = await new Promise((resolve, reject) => {
// 				loader.load(
// 					blobURL,
// 					(object) => resolve(object),
// 					undefined,
// 					(error) => reject(error)
// 				);
// 			});
		
// 			URL.revokeObjectURL(blobURL);
// 			// FBX files don't have original GLB buffer - will use Three.js export flow for simplification
// 			originalFileBufferRef.current = null;
// 			fileType = 'fbx';
// 			modelScale = 0.01; // FBX files typically use cm, need to scale down
// 		} else if (name.endsWith(".obj")) {
// 			model = new OBJLoader().parse(await file.text());
// 			fileType = 'obj';
// 			modelScale = 0.01; // OBJ files may need scaling
// 		} else if (name.endsWith(".glb") || name.endsWith(".gltf")) {
// 			const arrayBuffer = await file.arrayBuffer();
// 			if (signal && signal.aborted) {
// 				throw new DOMException("Aborted", "AbortError");
// 			}
// 			const blobURL = URL.createObjectURL(new Blob([arrayBuffer]));
// 			// Setup loader with KTX2 support for compressed textures
// 			const loader = new GLTFLoader();
// 			loader.setMeshoptDecoder(MeshoptDecoder);
// 			// Reuse shared KTX2Loader to avoid spawning duplicate worker threads
// 			const ktx2Loader = await getKTX2Loader();
// 			loader.setKTX2Loader(ktx2Loader);
// 			// Check if GLB has KTX2/Basis compressed textures before loading
// 			const hasCompressedTextures = await checkForCompressedTextures(arrayBuffer);
// 			hasCompressedTexturesRef.current = hasCompressedTextures;
// 			// Always store original buffer for simplification (preserves original texture encoding)
// 			originalFileBufferRef.current = arrayBuffer;
// 			if (hasCompressedTextures) {
// 				console.log(" Detected KTX2/Basis compressed textures - will preserve on export");
// 				// Notify parent component about compressed textures
// 				if (onTextureCompressionDetected) {
// 					onTextureCompressionDetected(true);
// 				}
// 			} else {
// 				console.log(" Stored original buffer for simplification (preserves texture encoding)");
// 				if (onTextureCompressionDetected) {
// 					onTextureCompressionDetected(false);
// 				}
// 			}
// 			if (signal && signal.aborted) {
// 				disposeKTX2Loader();
// 				URL.revokeObjectURL(blobURL);
// 				throw new DOMException("Aborted", "AbortError");
// 			}
// 			model = await new Promise((res, rej) => {
// 				loader.load(
// 					blobURL,
// 					(gltf) => res(gltf.scene),
// 					undefined,
// 					rej
// 				);
// 			});
// 			// KTX2Loader stays alive - reused across loads, disposed on unmount
// 			URL.revokeObjectURL(blobURL);
// 			fileType = name.endsWith(".glb") ? 'glb' : 'gltf';
// 			modelScale = 1; // GLB/GLTF files are in meters, no scaling needed
// 		} else {
// 			throw new Error("Unsupported format!");
// 		}

// 		// Check if cancelled before adding model to scene
// 		if (signal && signal.aborted) {
// 			throw new DOMException("Aborted", "AbortError");
// 		}

// 		// Store file type and scale for use in simplification
// 		modelFileTypeRef.current = fileType;
// 		originalModelScaleRef.current = modelScale;

// 		model.scale.setScalar(modelScale);
// 		scene.add(model);
// 		currentModelRef.current = model;
// 		originalModelRef.current = model;
// 		frameModel(model);
// 		updateModelStats(model);
// 		// console.log(` Model scale set to ${modelScale} for ${fileType} file`);

// 		// Check for unsupported texture formats in the loaded model (applies to all file types)
// 		const unsupportedTextures = checkForUnsupportedTextures(model);
// 		if (unsupportedTextures.length > 0) {
// 			// Clean up the model before throwing error
// 			scene.remove(model);
// 			currentModelRef.current = null;
// 			originalModelRef.current = null;
// 			throw new Error(`Unsupported texture format(s) detected: ${unsupportedTextures.join(', ')}. Only JPG, PNG, and KTX2 textures are supported.`);
// 		}

// 		// Check if model has textures and notify parent
// 		const hasTextures = checkModelHasTextures(model);
// 		modelHasTexturesRef.current = hasTextures;
// 		if (onModelHasTextures) {
// 			onModelHasTextures(hasTextures);
// 		}
// 		if (!hasTextures) {
// 			console.warn(" Model has no textures - texture compression will be disabled");
// 			showAlert({
// 				toast: true,
// 				error: true,
// 				message: "Model has no textures - texture compression will be disabled",
// 			});
// 		}

// 		console.log(" Model loaded:", model);
// 	};

// 	// Set wireframe mode
// 	const setWireframe = (enabled) => {
// 		const model = currentModelRef.current;
// 		if (!model) return;

// 		wireframeEnabledRef.current = enabled;

// 		model.traverse((obj) => {
// 			if (!obj.isMesh) return;

// 			if (enabled) {
// 				if (!originalMaterialsRef.current.has(obj)) {
// 					originalMaterialsRef.current.set(obj, obj.material);
// 				}
// 				const wireMat = obj.material.clone();
// 				wireMat.wireframe = true;
// 				wireMat.transparent = true;
// 				wireMat.opacity = 0.9;
// 				wireMat.depthTest = true;
// 				wireMat.needsUpdate = true;
// 				obj.material = wireMat;
// 			} else {
// 				if (originalMaterialsRef.current.has(obj)) {
// 					obj.material = originalMaterialsRef.current.get(obj);
// 					obj.material.wireframe = false;
// 					obj.material.needsUpdate = true;
// 				}
// 			}
// 		});

// 		updateModelStats(model);
// 	};

// 	// Clean attributes
// 	const cleanAttributes = (object3D) => {
// 		object3D.traverse((child) => {
// 			if (child.isMesh && child.geometry) {
// 				const keep = ["position", "normal", "uv", "uv2", "color"];
// 				for (const name in child.geometry.attributes) {
// 					if (!keep.includes(name.toLowerCase())) {
// 						child.geometry.deleteAttribute(name);
// 					}
// 				}
// 			}
// 		});
// 	};

// 	// Convert non-standard materials to MeshStandardMaterial (preserves colors for GLB export)
// 	const convertMaterialsForExport = (object3D) => {
// 		let convertedCount = 0;
// 		let skippedCount = 0;
		
// 		object3D.traverse((child) => {
// 			if (!child.isMesh || !child.material) return;

// 			const materials = Array.isArray(child.material) ? child.material : [child.material];
// 			const convertedMaterials = materials.map((mat) => {
// 				// Skip if already MeshStandardMaterial
// 				if (mat.isMeshStandardMaterial) {
// 					skippedCount++;
// 					return mat;
// 				}

// 				const meshName = child.name || 'unnamed_mesh';
// 				const matName = mat.name || 'unnamed_material';
// 				console.log(`\n Converting [${meshName}] -> [${matName}]`);
// 				console.log(`   From: ${mat.type}`);
				
// 				// Log original transparency properties BEFORE conversion
// 				console.log(`    Original transparency props:`);
// 				console.log(`      - transparent: ${mat.transparent}`);
// 				console.log(`      - opacity: ${mat.opacity}`);
// 				console.log(`      - alphaTest: ${mat.alphaTest}`);
// 				console.log(`      - alphaMap: ${mat.alphaMap ? 'YES' : 'NO'}`);
// 				console.log(`      - side: ${mat.side === THREE.FrontSide ? 'FrontSide' : mat.side === THREE.BackSide ? 'BackSide' : 'DoubleSide'}`);
// 				console.log(`      - depthWrite: ${mat.depthWrite}`);
// 				console.log(`      - blending: ${mat.blending}`);

// 				// Create MeshStandardMaterial and copy properties
// 				const stdMat = new THREE.MeshStandardMaterial();
				
// 				// Copy common properties
// 				if (mat.color) stdMat.color.copy(mat.color);
// 				if (mat.map) stdMat.map = mat.map;
// 				if (mat.normalMap) stdMat.normalMap = mat.normalMap;
// 				if (mat.aoMap) stdMat.aoMap = mat.aoMap;
// 				if (mat.emissive) stdMat.emissive.copy(mat.emissive);
// 				if (mat.emissiveMap) stdMat.emissiveMap = mat.emissiveMap;
// 				if (mat.emissiveIntensity !== undefined) stdMat.emissiveIntensity = mat.emissiveIntensity;
				
// 				// =========================================================
// 				// CRITICAL: Preserve transparency and alpha properties!
// 				// =========================================================
// 				stdMat.transparent = mat.transparent || false;
// 				stdMat.opacity = mat.opacity !== undefined ? mat.opacity : 1;
// 				stdMat.alphaTest = mat.alphaTest !== undefined ? mat.alphaTest : 0;
// 				stdMat.alphaToCoverage = mat.alphaToCoverage || false;
// 				stdMat.side = mat.side !== undefined ? mat.side : THREE.FrontSide;
// 				stdMat.depthWrite = mat.depthWrite !== undefined ? mat.depthWrite : true;
// 				stdMat.depthTest = mat.depthTest !== undefined ? mat.depthTest : true;
// 				stdMat.blending = mat.blending !== undefined ? mat.blending : THREE.NormalBlending;
// 				stdMat.premultipliedAlpha = mat.premultipliedAlpha || false;
// 				stdMat.name = mat.name;
				
// 				// Copy alpha map if exists
// 				if (mat.alphaMap) {
// 					stdMat.alphaMap = mat.alphaMap;
// 					console.log(`   Copied alphaMap`);
// 				}
				
// 				// Set reasonable defaults for PBR properties
// 				stdMat.metalness = mat.metalness !== undefined ? mat.metalness : 0.0;
// 				stdMat.roughness = mat.roughness !== undefined ? mat.roughness : 0.7;
				
// 				// Log converted transparency properties AFTER conversion
// 				console.log(`    Converted transparency props:`);
// 				console.log(`      - transparent: ${stdMat.transparent}`);
// 				console.log(`      - opacity: ${stdMat.opacity}`);
// 				console.log(`      - alphaTest: ${stdMat.alphaTest}`);
// 				console.log(`      - alphaMap: ${stdMat.alphaMap ? 'YES' : 'NO'}`);
// 				console.log(`      - side: ${stdMat.side === THREE.FrontSide ? 'FrontSide' : stdMat.side === THREE.BackSide ? 'BackSide' : 'DoubleSide'}`);
// 				console.log(`      - depthWrite: ${stdMat.depthWrite}`);
				
// 				convertedCount++;
// 				return stdMat;
// 			});

// 			child.material = Array.isArray(child.material) ? convertedMaterials : convertedMaterials[0];
// 		});
// 	};

// 	// Get texture key for deduplication
// 	const getTextureKey = (tex) => {
// 		if (!tex || !tex.image) return null;
// 		if (tex.image.src) return tex.image.src;
// 		if (tex.image.currentSrc) return tex.image.currentSrc;
// 		if (tex.image.width && tex.image.height)
// 			return `bitmap:${tex.image.width}x${tex.image.height}:${tex.uuid}`;
// 		if (tex.isDataTexture && tex.image?.data)
// 			return `data:${tex.image.width}x${tex.image.height}:${tex.uuid}`;
// 		return tex.uuid;
// 	};

// 	// Check if texture is trivial white
// 	const isTrivialWhiteTexture = (tex) => {
// 		if (!tex || !tex.image) return true;
// 		const w = tex.image.width || 0,
// 			h = tex.image.height || 0;
// 		if (w === 1 && h === 1) return true;

// 		if (tex.isDataTexture && tex.image.data && tex.image.data.length >= 3) {
// 			const d = tex.image.data;
// 			const r = d[0],
// 				g = d[1],
// 				b = d[2],
// 				a = d[3] ?? 255;
// 			return r === 255 && g === 255 && b === 255 && a === 255;
// 		}
// 		return false;
// 	};
// 	// Check if model has any textures
// 	const checkModelHasTextures = (model) => {
// 		let hasTextures = false;
// 		const textureMapTypes = [
// 			"map",
// 			"normalMap",
// 			"roughnessMap",
// 			"metalnessMap",
// 			"emissiveMap",
// 			"aoMap",
// 			"bumpMap",
// 			"displacementMap",
// 			"alphaMap",
// 			"envMap",
// 			"lightMap",
// 		];

// 		model.traverse((obj) => {
// 			if (!obj.isMesh || !obj.material) return;

// 			const materials = Array.isArray(obj.material)
// 				? obj.material
// 				: [obj.material];

// 			for (const mat of materials) {
// 				for (const mapType of textureMapTypes) {
// 					const tex = mat[mapType];
// 					if (tex && tex.isTexture) {
// 						// Check if it's a real texture (not trivial white)
// 						if (!isTrivialWhiteTexture(tex)) {
// 							hasTextures = true;
// 							return;
// 						}
// 					}
// 				}
// 			}
// 		});

// 		return hasTextures;
// 	};

// 	// Check for unsupported texture formats in the loaded model
// 	// Returns array of unsupported texture info, empty if all textures are valid
// 	const checkForUnsupportedTextures = (model) => {
// 		const unsupportedTextures = [];
// 		const textureMapTypes = [
// 			"map",
// 			"normalMap",
// 			"roughnessMap",
// 			"metalnessMap",
// 			"emissiveMap",
// 			"aoMap",
// 			"bumpMap",
// 			"displacementMap",
// 			"alphaMap",
// 			"envMap",
// 			"lightMap",
// 		];
// 		const unsupportedExtensions = ['tga', 'webp', 'bmp', 'gif', 'tiff', 'tif', 'exr', 'hdr', 'dds', 'psd'];
// 		const checkedTextures = new Set(); // Avoid duplicate checks

// 		model.traverse((obj) => {
// 			if (!obj.isMesh || !obj.material) return;

// 			const materials = Array.isArray(obj.material)
// 				? obj.material
// 				: [obj.material];

// 			for (const mat of materials) {
// 				for (const mapType of textureMapTypes) {
// 					const tex = mat[mapType];
// 					if (tex && tex.isTexture && !checkedTextures.has(tex.uuid)) {
// 						checkedTextures.add(tex.uuid);
						
// 						// Get texture name from various sources
// 						const textureName = tex.name || tex.sourceFile || tex.userData?.fileName || '';
						
// 						// Check source file extension if available
// 						if (textureName) {
// 							const ext = textureName.toLowerCase().split('.').pop();
// 							if (unsupportedExtensions.includes(ext)) {
// 								unsupportedTextures.push(textureName);
// 								continue;
// 							}
// 						}

// 						// Check if texture has valid image data that GLTFExporter can process
// 						const image = tex.image;
// 						if (!image) {
// 							// Texture has no image data - likely failed to load or unsupported format
// 							unsupportedTextures.push(textureName || `${mat.name || 'material'}_${mapType}`);
// 							continue;
// 						}

// 						// For FBX embedded textures, check if the image can be exported
// 						// GLTFExporter requires HTMLImageElement, HTMLCanvasElement, or ImageBitmap
// 						const isValidImageType = (
// 							image instanceof HTMLImageElement ||
// 							image instanceof HTMLCanvasElement ||
// 							(typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) ||
// 							(typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas)
// 						);

// 						if (!isValidImageType) {
// 							// Check if it's a data texture that might be from TGA or other unsupported format
// 							if (image.data && !(image instanceof ImageData)) {
// 								// This is likely a DataTexture from an unsupported format like TGA
// 								unsupportedTextures.push(textureName || `${mat.name || 'material'}_${mapType} (unsupported format)`);
// 							}
// 						}

// 						// For HTMLImageElement, check if the image is actually loaded
// 						if (image instanceof HTMLImageElement && !image.complete) {
// 							unsupportedTextures.push(textureName || `${mat.name || 'material'}_${mapType}`);
// 						}
// 					}
// 				}
// 			}
// 		});

// 		return unsupportedTextures;
// 	};

// 	// Check if GLB has KTX2/Basis compressed textures
// 	const checkForCompressedTextures = async (arrayBuffer) => {
// 		try {
// 			// Parse GLB header to extract JSON chunk
// 			const dataView = new DataView(arrayBuffer);
// 			// GLB header: magic (4) + version (4) + length (4)
// 			const magic = dataView.getUint32(0, true);
// 			if (magic !== 0x46546C67) {
// 				// Not a GLB file, check for GLTF JSON
// 				return false;
// 			}
// 			// First chunk header: length (4) + type (4)
// 			const chunkLength = dataView.getUint32(12, true);
// 			const chunkType = dataView.getUint32(16, true);
// 			// 0x4E4F534A = "JSON"
// 			if (chunkType !== 0x4E4F534A) {
// 				return false;
// 			}
// 			// Extract JSON chunk
// 			const jsonBytes = new Uint8Array(arrayBuffer, 20, chunkLength);
// 			const jsonString = new TextDecoder().decode(jsonBytes);
// 			const gltfJson = JSON.parse(jsonString);
// 			// Check for KTX2/Basis extensions in textures
// 			if (gltfJson.extensionsUsed) {
// 				const compressedExtensions = [
// 					'KHR_texture_basisu',
// 					'EXT_texture_webp', // WebP is also compressed
// 				];
// 				for (const ext of compressedExtensions) {
// 					if (gltfJson.extensionsUsed.includes(ext)) {
// 						console.log(` Found compressed texture extension: ${ext}`);
// 						return true;
// 					}
// 				}
// 			}
// 			// Also check image mimeTypes for KTX2
// 			if (gltfJson.images) {
// 				for (const image of gltfJson.images) {
// 					if (image.mimeType === 'image/ktx2' ||
// 						(image.uri && image.uri.endsWith('.ktx2'))) {
// 						console.log('🔍 Found KTX2 image in GLTF');
// 						return true;
// 					}
// 				}
// 			}
// 			return false;
// 		} catch (error) {
// 			console.warn('Error checking for compressed textures:', error);
// 			showAlert({
// 				toast: true,
// 				error: true,
// 				message: "Error checking for compressed textures: " + error.message,
// 			});
// 			return false;
// 		}
// 	};
// 	// Dedupe and prune textures
// 	const dedupeAndPruneTextures = (root) => {
// 		if (hasCompressedTexturesRef.current) {
// 			console.warn(" Skipping texture prune (KTX2 model)");
// 			return;
// 		}
// 		if (!modelHasTexturesRef.current) {
// 			console.warn(" Skipping texture prune (model has no textures)");
// 			return;
// 		}
// 		const cache = new Map();

// 		root.traverse((obj) => {
// 			if (!obj.isMesh || !obj.material) return;

// 			const materials = Array.isArray(obj.material)
// 				? obj.material
// 				: [obj.material];

// 			for (const mat of materials) {
// 				if (!(mat instanceof THREE.MeshStandardMaterial)) {
// 					const stdMat = new THREE.MeshStandardMaterial();
// 					stdMat.copy(mat);
// 					obj.material = stdMat;
// 				}

// 				const supportedMaps = [
// 					"map",
// 					"normalMap",
// 					"roughnessMap",
// 					"metalnessMap",
// 					"emissiveMap",
// 					"aoMap",
// 					"alphaMap",
// 				];
// 				for (const key of supportedMaps) {
// 					const tex = mat[key];
// 					if (!tex) continue;

// 					if (isTrivialWhiteTexture(tex)) {
// 						mat[key] = null;
// 						continue;
// 					}

// 					const k = getTextureKey(tex);
// 					if (!k) continue;

// 					if (cache.has(k)) {
// 						mat[key] = cache.get(k);
// 					} else {
// 						cache.set(k, tex);
// 					}
// 				}

// 				if (!mat.emissive) mat.emissive = new THREE.Color(0x000000);

// 				if (mat.emissive.isColor) {
// 					const isBlack = mat.emissive.equals(new THREE.Color(0x000000));
// 					if (mat.emissiveMap && isBlack) {
// 						mat.emissive.setRGB(1, 1, 1);
// 					}
// 				}

// 				for (const k of Object.keys(mat)) {
// 					const v = mat[k];
// 					//  DO NOT remove KTX2 / GPU-only textures
// 					if (
// 						v &&
// 						v.isTexture &&
// 						!v.image &&
// 						!v.isCompressedTexture
// 					) {
// 						mat[k] = null;
// 					}
// 				}

// 				if (mat.metalness === undefined) mat.metalness = 0.5;
// 				if (mat.roughness === undefined) mat.roughness = 0.5;

// 				mat.needsUpdate = true;
// 			}
// 		});
// 	};

// 	// Export to GLB buffer
// 	const exportGLBBuffer = async (model) => {
// 		console.log(" ========== GLTFExporter: Exporting to GLB Buffer ==========");
		
// 		// Log material info before GLTF export
// 		let meshCount = 0;
// 		model.traverse((obj) => {
// 			if (!obj.isMesh || !obj.material) return;
			
// 			const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
// 			materials.forEach((mat) => {
// 				const meshName = obj.name || `Mesh_${meshCount}`;
// 				const matName = mat.name || 'unnamed';
				
// 				// Only log materials with transparency
// 				if (mat.transparent || mat.alphaTest > 0 || mat.opacity < 1 || mat.alphaMap) {
// 					console.log(` [GLTFExporter Input] ${meshName} -> ${matName}:`);
// 					console.log(`   - transparent: ${mat.transparent}`);
// 					console.log(`   - opacity: ${mat.opacity}`);
// 					console.log(`   - alphaTest: ${mat.alphaTest}`);
// 					console.log(`   - alphaMap: ${mat.alphaMap ? 'YES' : 'NO'}`);
// 					console.log(`   - alphaMode (expected): ${mat.alphaTest > 0 ? 'MASK' : mat.transparent ? 'BLEND' : 'OPAQUE'}`);
// 					console.log(`   - side: ${mat.side === THREE.FrontSide ? 'FrontSide' : mat.side === THREE.BackSide ? 'BackSide' : 'DoubleSide'}`);
// 				}
// 			});
// 			meshCount++;
// 		});
		
// 		return new Promise((resolve, reject) => {
// 			const exporter = new GLTFExporter();
// 			exporter.parse(
// 				model,
// 				(result) => {
// 					const buffer = result instanceof ArrayBuffer
// 						? result
// 						: new TextEncoder().encode(JSON.stringify(result));
					
// 					// Parse and log the exported GLTF JSON to verify alphaMode- for testing purposes
// 					//=========================================================
// 					try {
// 						if (result instanceof ArrayBuffer) {
// 							const dataView = new DataView(result);
// 							const jsonLength = dataView.getUint32(12, true);
// 							const jsonBytes = new Uint8Array(result, 20, jsonLength);
// 							const jsonString = new TextDecoder().decode(jsonBytes);
// 							const gltfJson = JSON.parse(jsonString);
							
// 							console.log(" [GLTFExporter Output] Exported GLTF materials:");
// 							if (gltfJson.materials) {
// 								gltfJson.materials.forEach((mat, idx) => {
// 									console.log(`   Material[${idx}] "${mat.name || 'unnamed'}":`);
// 									console.log(`      - alphaMode: ${mat.alphaMode || 'OPAQUE (default)'}`);
// 									console.log(`      - alphaCutoff: ${mat.alphaCutoff !== undefined ? mat.alphaCutoff : 'N/A'}`);
// 									console.log(`      - doubleSided: ${mat.doubleSided || false}`);
// 									if (mat.pbrMetallicRoughness) {
// 										const pbr = mat.pbrMetallicRoughness;
// 										if (pbr.baseColorFactor) {
// 											console.log(`      - baseColorFactor[3] (alpha): ${pbr.baseColorFactor[3]}`);
// 										}
// 									}
// 								});
// 							}
							
// 							// Log extensions used
// 							if (gltfJson.extensionsUsed) {
// 								console.log(` Extensions used: ${gltfJson.extensionsUsed.join(', ')}`);
// 							}
// 						}
// 					} catch (parseError) {
// 						console.warn("Could not parse exported GLTF for logging:", parseError);
// 					}
// 					//=========================================================
// 					resolve(buffer);
// 				},
// 				(error) => reject(error),
// 				{
// 					binary: true,
// 					embedImages: true,
// 					onlyVisible: true,
// 				}
// 			);
// 		});
// 	};

// 	// Run gltfpack in background worker
// 	const runGltfpackInBackground = async (glbBuffer, args, onProgress, signal) => {
// 		return new Promise((resolve, reject) => {
// 			// If already aborted before starting, reject immediately
// 			if (signal && signal.aborted) {
// 				reject(new DOMException("Aborted", "AbortError"));
// 				return;
// 			}

// 			const worker = new Worker(
// 				process.env.PUBLIC_URL + "/gltfpack/gltfpack.worker.js"
// 			);

// 			let settled = false;

// 			// Listen for abort signal to terminate worker and its threads
// 			const onAbort = () => {
// 				if (!settled) {
// 					settled = true;
// 					console.log("[gltfpack worker] Terminating worker due to abort signal");
// 					worker.terminate();
// 					reject(new DOMException("Aborted", "AbortError"));
// 				}
// 			};

// 			if (signal) {
// 				signal.addEventListener("abort", onAbort);
// 			}

// 			worker.postMessage({ type: "init" });

// 			worker.onmessage = (e) => {
// 				if (settled) return;
// 				const { type, msg, result, percent } = e.data;

// 				switch (type) {
// 					case "ready":
// 						if (onProgress) onProgress("Initializing gltfpack...", 5);
// 						worker.postMessage({ type: "run", data: glbBuffer, args });
// 						break;
// 					case "progress":
// 						console.log(` progress: ${percent}% - ${msg}`);
// 						if (onProgress) onProgress(msg, percent);
// 						break;
// 					case "log":
// 						console.log("message:", msg);
// 						// Parse log messages for progress estimation
// 						if (msg.includes("Writing input")) {
// 							if (onProgress) onProgress("Writing input file...", 10);
// 						} else if (msg.includes("Running gltfpack")) {
// 							if (onProgress) onProgress("Processing with gltfpack...", 20);
// 						} else if (msg.includes("gltfpack finished")) {
// 							if (onProgress) onProgress("gltfpack complete!", 80);
// 						} else if (msg.includes("Output file")) {
// 							if (onProgress) onProgress("Reading output...", 90);
// 						} else if (msg.includes("Sending result")) {
// 							if (onProgress) onProgress("Finalizing...", 95);
// 						}
// 						break;
// 					case "error":
// 						if (!settled) {
// 							settled = true;
// 							if (signal) signal.removeEventListener("abort", onAbort);
// 							console.error(" gltfpack error:", msg);
// 							worker.terminate();
// 							reject(new Error(msg));
// 						}
// 						break;
// 					case "done":
// 						if (!settled) {
// 							settled = true;
// 							if (signal) signal.removeEventListener("abort", onAbort);
// 							worker.terminate();
// 							if (onProgress) onProgress("Complete!", 100);
// 							resolve(result.buffer);
// 						}
// 						break;
// 					default:
// 						break;
// 			}
// 		};

// 			worker.onerror = (err) => {
// 				if (!settled) {
// 					settled = true;
// 					if (signal) signal.removeEventListener("abort", onAbort);
// 					console.error("[gltfpack worker] Unexpected error:", err);
// 					worker.terminate();
// 					reject(new Error(err.message || "Worker error"));
// 				}
// 			};
// 		});
// 	};

// 	// Simplify model
// 	const simplifyModel = async (simplifyValue, keepNodes, onProgress, signal) => {
// 		const originalModel = originalModelRef.current;
// 		if (!originalModel) throw new Error("No model loaded!");
// 		const hasKTX2 = hasCompressedTexturesRef.current;
// 		if (onProgress) onProgress("Preparing model...", 5);

// 		const wasWireframe = wireframeEnabledRef.current;
// 		if (wasWireframe) setWireframe(false);
// 		// =========================================================
// 		// Use original file buffer when available (preserves texture encoding)
// 		// This prevents size inflation from Three.js GLTFExporter re-encoding
// 		// =========================================================
// 		if (originalFileBufferRef.current) {
// 			console.log(" Using original buffer for simplification (preserves texture encoding)");
// 			const args = [
// 				"-i",
// 				"/input.glb",
// 				"-o",
// 				"/output.glb",
// 				"-si",
// 				simplifyValue.toString(),
// 				// Note: Do NOT use -cc (meshopt compression) as Unity doesn't support EXT_meshopt_compression
// 			];
// 			if (keepNodes) args.push("-kn");
// 			const optimized = await runGltfpackInBackground(
// 				originalFileBufferRef.current,
// 				args,
// 				onProgress,
// 				signal
// 			);
// 			if (signal && signal.aborted) {
// 				throw new DOMException("Aborted", "AbortError");
// 			}
// 			// Store the simplified buffer for export
// 			simplifiedBufferRef.current = optimized;
// 			if (onProgress) onProgress("Loading simplified preview...", 95);
// 			const blob = new Blob([optimized], { type: "model/gltf-binary" });
// 			const url = URL.createObjectURL(blob);
// 			const loader = new GLTFLoader();
// 			loader.setMeshoptDecoder(MeshoptDecoder);
// 			// Reuse shared KTX2Loader to avoid spawning duplicate worker threads
// 			if (hasKTX2) {
// 				const ktx2Loader = await getKTX2Loader();
// 				loader.setKTX2Loader(ktx2Loader);
// 			}
// 			const gltf = await loader.loadAsync(url);
// 			// KTX2Loader stays alive - reused across loads, disposed on unmount
// 			const scene = sceneRef.current;
// 			if (currentModelRef.current) scene.remove(currentModelRef.current);
// 			currentModelRef.current = gltf.scene;
// 			// Apply same scale as original model
// 			currentModelRef.current.scale.setScalar(originalModelScaleRef.current);
// 			scene.add(currentModelRef.current);
// 			updateModelStats(currentModelRef.current, optimized.byteLength);
// 			frameModel(currentModelRef.current);
// 			URL.revokeObjectURL(url);
// 			if (wasWireframe) setWireframe(true);
// 			if (onProgress) onProgress("Complete!", 100);
// 			console.log(` Simplified using original buffer (${(optimized.byteLength / 1024 / 1024).toFixed(2)} MB)`);
// 			return;
// 		}
// 		// =========================================================
// 		// Fallback: No original buffer (e.g., FBX, OBJ, ZIP imports)
// 		// Use Three.js export flow
// 		// =========================================================
// 		console.log(" No original buffer - using Three.js export (may affect texture encoding)");
// 		cleanAttributes(originalModel);
// 		convertMaterialsForExport(originalModel); // Convert FBX MeshPhongMaterial to MeshStandardMaterial
// 		dedupeAndPruneTextures(originalModel);
// 		if (onProgress) onProgress("Exporting to GLB buffer...", 10);
// 		const glbBuffer = await exportGLBBuffer(originalModel);
// 		const args = [
// 			"-i",
// 			"/input.glb",
// 			"-o",
// 			"/output.glb",
// 			"-si",
// 			simplifyValue.toString(),
// 			// Note: Do NOT use -cc (meshopt compression) as Unity doesn't support EXT_meshopt_compression
// 		];
// 		if (keepNodes) args.push("-kn");
// 		// args.push("-vpf");

// 		// console.log(" Running simplify in background:", args);

// 		// if (onProgress) onProgress("Exporting to GLB buffer...", 10);
// 		// const glbBuffer = await exportGLBBuffer(originalModel);
// 		const optimized = await runGltfpackInBackground(
// 			glbBuffer,
// 			args,
// 			onProgress,
// 			signal
// 		);
// 		if (signal && signal.aborted) {
// 			throw new DOMException("Aborted", "AbortError");
// 		}
// 		// Store the simplified buffer for export
// 		simplifiedBufferRef.current = optimized;
// 		if (onProgress) onProgress("Loading simplified model...", 95);
// 		const blob = new Blob([optimized], { type: "model/gltf-binary" });
// 		const optimizedSize = optimized.byteLength || optimized.length;
// 		const url = URL.createObjectURL(blob);
// 		const loader = new GLTFLoader();
// 		loader.setMeshoptDecoder(MeshoptDecoder);
// 		const gltf = await loader.loadAsync(url);

// 		const scene = sceneRef.current;
// 		if (currentModelRef.current) scene.remove(currentModelRef.current);
// 		currentModelRef.current = gltf.scene;
// 		// Note: Scale is already baked into the exported GLB, don't re-apply
// 		scene.add(currentModelRef.current);

// 		// Pass optimized size to stats update
// 		updateModelStats(currentModelRef.current, optimizedSize);
// 		frameModel(currentModelRef.current);
// 		// URL.revokeObjectURL(url);
// 		if (wasWireframe) setWireframe(true);

// 		if (onProgress) onProgress("Complete!", 100);
// 		console.log(
// 			` Simplified preview loaded (${(optimizedSize / 1024 / 1024).toFixed(
// 				2
// 			)} MB)`
// 		);
// 		URL.revokeObjectURL(url);
// 	};

// 	// Export GLB
// 	const exportGLB = async (options, onProgress) => {
// 		// Use current model (may already be simplified) instead of original
// 		const modelToExport = currentModelRef.current;
// 		if (!modelToExport) throw new Error("No model loaded!");

// 		if (onProgress) onProgress("Preparing model...", 5);

// 		const startTime = performance.now();
// 		// Check if model has pre-compressed textures (KTX2/Basis)
// 		const hasPreCompressedTextures = hasCompressedTexturesRef.current;
// 		let blob, exportedSize;
// 		// Check if we have a simplified buffer from previous simplification
// 		const hasSimplifiedBuffer = simplifiedBufferRef.current !== null;
// 		// For KTX2 models: preserve existing compressed textures
// 		if (hasPreCompressedTextures && (hasSimplifiedBuffer || originalFileBufferRef.current)) {
// 			// Use simplified buffer if available, otherwise use original
// 			const bufferToUse = hasSimplifiedBuffer
// 				? simplifiedBufferRef.current
// 				: originalFileBufferRef.current;
// 			console.log(hasSimplifiedBuffer
// 				? " Using simplified buffer - preserving KTX2/Basis compressed textures"
// 				: " Using original buffer - preserving KTX2/Basis compressed textures exactly");
// 			if (onProgress) onProgress("Preserving compressed textures...", 50);
// 			blob = new Blob([bufferToUse], { type: "model/gltf-binary" });
// 			exportedSize = bufferToUse.byteLength;
// 			if (onProgress) onProgress("Processing file...", 92);
// 		} else if (hasSimplifiedBuffer && !options.textureCompression) {
// 			// Non-KTX2 model with simplified buffer AND no texture compression requested
// 			// Use the simplified buffer directly (already simplified, no TC needed)
// 			console.log(" Using simplified buffer for export (no TC)");
// 			if (onProgress) onProgress("Preparing simplified model...", 50);
// 			blob = new Blob([simplifiedBufferRef.current], { type: "model/gltf-binary" });
// 			exportedSize = simplifiedBufferRef.current.byteLength;
// 			if (onProgress) onProgress("Processing file...", 92);
// 		} else if (hasSimplifiedBuffer && options.textureCompression) {
// 			// Non-KTX2 model with simplified buffer AND texture compression requested
// 			// Need to run gltfpack with -tc on the simplified buffer
// 			console.log(" Applying texture compression to simplified buffer");
// 			if (onProgress) onProgress("Compressing textures...", 20);

// 			const args = ["-i", "/input.glb", "-o", "/output.glb", "-tc"];
// 			const quality = options.textureQuality || 10;
// 			args.push("-tq", quality.toString());
// 			console.log(` Texture compression enabled (quality: ${quality})`);

// 			if (options.keepNodeNames) {
// 				args.push("-kn");
// 			} else {
// 				args.push("-mm");
// 				args.push("-mi");
// 			}
// 			args.push("-vpf"); // Vertex position format

// 			console.log(" Exporting with args:", args, "(using pre-simplified model with TC)");

// 			const optimizeStart = performance.now();
// 			const optimized = await runGltfpackInBackground(
// 				simplifiedBufferRef.current,
// 				args,
// 				onProgress,
// 				options.signal
// 			);
// 			const optimizeEnd = performance.now();
// 			console.log(
// 				` gltfpack optimization time: ${(optimizeEnd - optimizeStart).toFixed(2)} ms`
// 			);

// 			if (onProgress) onProgress("Processing file...", 92);
// 			blob = new Blob([optimized], { type: "model/gltf-binary" });
// 			exportedSize = optimized.byteLength || optimized.length;
// 		} else {
// 			// Standard flow for non-KTX2 models: export through Three.js and gltfpack
// 			cleanAttributes(modelToExport);
// 			convertMaterialsForExport(modelToExport); // Convert FBX MeshPhongMaterial to MeshStandardMaterial
// 			dedupeAndPruneTextures(modelToExport);

// 			// if (onProgress) onProgress("Exporting to GLB buffer...", 10);
// 			// const glbBuffer = await exportGLBBuffer(modelToExport);
// 			const args = ["-i", "/input.glb", "-o", "/output.glb"];
// 			if (options.textureCompression) {
// 				args.push("-tc");
// 				// Use all available CPU cores for parallel texture compression
// 				const threadCount = navigator.hardwareConcurrency || 4;
// 				// args.push('-tj', threadCount.toString());
// 				// Texture quality (1-10): lower = faster compression, higher = better quality
// 				const quality = options.textureQuality || 10;
// 				args.push("-tq", quality.toString());
// 				console.log(
// 					` Using ${threadCount} threads for texture compression (quality: ${quality})`
// 				);
// 			}
// 		// else {
// 		//   // Without texture compression, textures stay as PNG/JPEG
// 		//   // Add mesh compression to at least reduce geometry size
// 		//   // args.push('-c'); // Enable mesh compression (Draco-like)
// 		// }
// 			if (options.keepNodeNames) {
// 				args.push("-kn");
// 			} else {
// 				args.push("-mm");
// 				args.push("-mi");
// 			}

// 			// Quantization and optimization
// 			args.push("-vpf"); // Vertex position format
// 			// args.push('-cc'); // Compress vertex colors

// 		// Skip simplification if model was already simplified (currentModel !== originalModel)
// 			// Check if model was already simplified (currentModel !== originalModel)
// 			const isAlreadySimplified =
// 			currentModelRef.current !== originalModelRef.current;
// 			// Skip simplification if model was already simplified
// 			if (options.simplifyValue < 1.0 && !isAlreadySimplified) {
// 				args.push("-si", options.simplifyValue.toString());
// 			}

// 			console.log(
// 				" Exporting with args:",
// 				args,
// 				isAlreadySimplified ? "(using pre-simplified model)" : ""
// 			);

// 			if (onProgress) onProgress("Exporting to GLB buffer...", 10);
// 			const glbBuffer = await exportGLBBuffer(modelToExport);
// 			const optimizeStart = performance.now();
// 			const optimized = await runGltfpackInBackground(
// 				glbBuffer,
// 				args,
// 				onProgress,
// 				options.signal
// 			);
// 			const optimizeEnd = performance.now();

// 			console.log(
// 				` gltfpack optimization time: ${(optimizeEnd - optimizeStart).toFixed(
// 					2
// 				)} ms`
// 			);

// 			if (onProgress) onProgress("Processing file...", 92);
// 			// Create blob from optimized buffer
// 			blob = new Blob([optimized], { type: "model/gltf-binary" });
// 			exportedSize = optimized.byteLength || optimized.length;
// 		}
// 		// Generate filename: originalname_optimized.glb with duplicate handling
// 		let exportFileName = "optimized.glb";
// 		if (options.fileName) {
// 			const baseName = options.fileName.replace(/\.[^/.]+$/, ""); // Remove extension
// 			let baseExportName = `${baseName}_optimized.glb`;

// 			// Check for duplicates and add number suffix if needed
// 			if (options.existingFileNames && options.existingFileNames.length > 0) {
// 				const existingNames = options.existingFileNames;
// 				let counter = 0;
// 				exportFileName = baseExportName;

// 				// Check if filename exists, if so add (1), (2), etc.
// 				while (existingNames.includes(exportFileName)) {
// 					counter++;
// 					const nameWithoutExt = baseExportName.replace(/\.glb$/, "");
// 					exportFileName = `${nameWithoutExt}(${counter}).glb`;
// 				}
// 			} else {
// 				exportFileName = baseExportName;
// 			}
// 		}

// 		// If onExportComplete callback is provided, return the blob instead of downloading
// 		if (options.onExportComplete) {
// 			// Capture screenshot before sending to callback
// 			if (onProgress) onProgress("Capturing screenshot...", 93);
// 			const screenshot = await captureScreenshot(512, 512);
			
// 			console.log(
// 				`📤 Returning blob: ${exportFileName} (${(exportedSize / 1024).toFixed(
// 					1
// 				)} KB)${screenshot ? ` with screenshot (${(screenshot.size / 1024).toFixed(1)} KB)` : ""}`
// 			);
			
// 			// Include screenshot in the callback along with filename and size
// 			options.onExportComplete(blob, exportFileName, exportedSize, screenshot);
// 		} else {
// 			// Download file
// 			const url = URL.createObjectURL(blob);
// 			const a = document.createElement("a");
// 			a.href = url;
// 			a.download = exportFileName;
// 			a.click();
// 			URL.revokeObjectURL(url);
// 			console.log(
// 				` Downloaded: ${exportFileName} (${(exportedSize / 1024).toFixed(
// 					1
// 				)} KB)`
// 			);
// 		}

// 		// Only load preview if not using callback mode (callback mode means we're closing the optimizer)
// 		if (!options.onExportComplete) {
// 			if (onProgress) onProgress("Loading preview...", 95);
// 			// Load preview
// 			const previewUrl = URL.createObjectURL(blob);
// 			const loader = new GLTFLoader();
// 			loader.setMeshoptDecoder(MeshoptDecoder);
// 			// Reuse shared KTX2Loader to avoid spawning duplicate worker threads
// 			if (options.textureCompression) {
// 				const ktx2Loader = await getKTX2Loader();
// 				loader.setKTX2Loader(ktx2Loader);
// 			}

// 			const gltf = await loader.loadAsync(previewUrl);
// 			// KTX2Loader stays alive - reused across loads, disposed on unmount
// 			const scene = sceneRef.current;
// 			if (currentModelRef.current) scene.remove(currentModelRef.current);
// 			currentModelRef.current = gltf.scene;
// 			scene.add(currentModelRef.current);
// 			frameModel(currentModelRef.current);

// 			// Pass null for optimizedSize (preview), but pass exportedSize
// 			updateModelStats(currentModelRef.current, null, exportedSize);
// 			URL.revokeObjectURL(previewUrl);
// 		}

// 		const endTime = performance.now();
// 		const totalSeconds = ((endTime - startTime) / 1000).toFixed(2);
// 		if (onProgress) onProgress(`Export complete in ${totalSeconds}s`, 100);
// 		console.log(
// 			`Export complete in ${totalSeconds}s (${(exportedSize / 1024).toFixed(
// 				1
// 			)} KB)`
// 		);
// 	};

// 	// Capture screenshot of the current model view
// 	const captureScreenshot = async (width = 512, height = 512) => {
// 		const renderer = rendererRef.current;
// 		const scene = sceneRef.current;
// 		const camera = cameraRef.current;
// 		const model = currentModelRef.current;

// 		if (!renderer || !scene || !camera || !model) {
// 			console.warn("Cannot capture screenshot: missing renderer, scene, camera, or model");
// 			showAlert({
// 				toast: true,
// 				error: true,
// 				message: "Cannot capture screenshot: missing renderer, scene, camera, or model",
// 			});
// 			return null;
// 		}

// 		try {
// 			// Store original renderer size
// 			const originalSize = renderer.getSize(new THREE.Vector2());
// 			const originalPixelRatio = renderer.getPixelRatio();

// 			// Create an offscreen canvas for the screenshot
// 			const offscreenCanvas = document.createElement("canvas");
// 			offscreenCanvas.width = width;
// 			offscreenCanvas.height = height;

// 			// Create a temporary renderer for the screenshot
// 			const screenshotRenderer = new THREE.WebGLRenderer({
// 				canvas: offscreenCanvas,
// 				antialias: true,
// 				preserveDrawingBuffer: true,
// 				alpha: false,
// 			});
// 			screenshotRenderer.setSize(width, height);
// 			screenshotRenderer.setPixelRatio(1);
// 			screenshotRenderer.outputColorSpace = THREE.SRGBColorSpace;

// 			// Create a temporary camera with the same settings but square aspect
// 			const screenshotCamera = camera.clone();
// 			screenshotCamera.aspect = width / height;
// 			screenshotCamera.updateProjectionMatrix();

// 			// Frame the model properly for the screenshot
// 			const box = new THREE.Box3().setFromObject(model);
// 			const center = box.getCenter(new THREE.Vector3());
// 			const size = box.getSize(new THREE.Vector3());
// 			const maxDim = Math.max(size.x, size.y, size.z);
// 			const fov = screenshotCamera.fov * (Math.PI / 180);
// 			let cameraDistance = maxDim / (2 * Math.tan(fov / 2));
// 			cameraDistance *= 1.5; // Add some padding

// 			// Position camera to look at the model from a nice angle
// 			screenshotCamera.position.set(
// 				center.x + cameraDistance * 0.7,
// 				center.y + cameraDistance * 0.5,
// 				center.z + cameraDistance * 0.7
// 			);
// 			screenshotCamera.lookAt(center);
// 			screenshotCamera.updateProjectionMatrix();

// 			// Render the scene
// 			screenshotRenderer.render(scene, screenshotCamera);

// 			// Get the image data
// 			const dataUrl = offscreenCanvas.toDataURL("image/png");

// 			// Convert data URL to Blob
// 			const response = await fetch(dataUrl);
// 			const blob = await response.blob();

// 			// Cleanup
// 			screenshotRenderer.dispose();

// 			console.log(` Screenshot captured: ${width}x${height} (${(blob.size / 1024).toFixed(1)} KB)`);

// 			return {
// 				blob,
// 				dataUrl,
// 				width,
// 				height,
// 				size: blob.size,
// 			};
// 		} catch (error) {
// 			console.error("Failed to capture screenshot:", error);
// 			return null;
// 		}
// 	};

// 	// Set background color
// 	const setBackgroundColor = (color) => {
// 		const scene = sceneRef.current;
// 		if (scene) {
// 			scene.background = new THREE.Color(color);
// 		}
// 	};

// 	// Expose methods to parent
// 	useImperativeHandle(ref, () => ({
// 		loadModel,
// 		setWireframe,
// 		simplifyModel,
// 		exportGLB,
// 		setBackgroundColor,
// 		captureScreenshot,
// 		disposeKTX2Loader,
// 	}));

// 	return <div ref={containerRef} className="canvas-container" />;
// });

// export default ThreeCanvas;


