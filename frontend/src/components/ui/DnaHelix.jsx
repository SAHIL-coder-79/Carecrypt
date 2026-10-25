import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export function DnaHelix({ className = "absolute inset-0 pointer-events-none opacity-80", style = {} }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const w = mountRef.current.clientWidth;
    const h = mountRef.current.clientHeight;
    const scene = new THREE.Scene();
    
    // Camera
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    camera.position.z = 15;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountRef.current.appendChild(renderer.domElement);

    // Group for DNA
    const dnaGroup = new THREE.Group();
    scene.add(dnaGroup);

    // Particles and lines
    const numBasePairs = 40;
    const radius = 1.8;
    const heightSpacing = 0.35;
    const twist = 0.3;

    const baseMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.9,
      roughness: 0.1,
      metalness: 0.8,
    });

    const bridgeMaterial = new THREE.LineBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.4,
    });

    const sphereGeometry = new THREE.SphereGeometry(0.12, 16, 16);
    const bridgeGeometries = [];

    for (let i = 0; i < numBasePairs; i++) {
      const y = (i - numBasePairs / 2) * heightSpacing;
      const angle = i * twist;

      // Strand 1
      const x1 = Math.cos(angle) * radius;
      const z1 = Math.sin(angle) * radius;
      const sphere1 = new THREE.Mesh(sphereGeometry, baseMaterial);
      sphere1.position.set(x1, y, z1);
      dnaGroup.add(sphere1);

      // Strand 2
      const x2 = Math.cos(angle + Math.PI) * radius;
      const z2 = Math.sin(angle + Math.PI) * radius;
      const sphere2 = new THREE.Mesh(sphereGeometry, baseMaterial);
      sphere2.position.set(x2, y, z2);
      dnaGroup.add(sphere2);

      // Bridge
      const bridgeGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x1, y, z1),
        new THREE.Vector3(x2, y, z2)
      ]);
      bridgeGeometries.push(bridgeGeo);
      const bridge = new THREE.Line(bridgeGeo, bridgeMaterial);
      dnaGroup.add(bridge);
    }

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const pointLight = new THREE.PointLight(0x38bdf8, 2, 50);
    pointLight.position.set(5, 5, 10);
    scene.add(pointLight);

    // Mouse tracking
    let targetRotationX = 0;
    let targetRotationY = 0;
    let mouseX = 0;
    let mouseY = 0;

    const onMouseMove = (event) => {
      mouseX = (event.clientX / window.innerWidth) * 2 - 1;
      mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', onMouseMove);

    // Animation Loop
    let req;
    const animate = () => {
      req = requestAnimationFrame(animate);

      // Constant slow rotation
      dnaGroup.rotation.y += 0.003;

      // Mouse tracking rotation (spring physics)
      targetRotationY = mouseX * 0.5;
      targetRotationX = -mouseY * 0.5;

      dnaGroup.rotation.y += (targetRotationY - (dnaGroup.rotation.y % (Math.PI * 2))) * 0.05;
      dnaGroup.rotation.x += (targetRotationX - dnaGroup.rotation.x) * 0.05;

      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const onResize = () => {
      if (!mountRef.current) return;
      const rw = mountRef.current.clientWidth;
      const rh = mountRef.current.clientHeight;
      renderer.setSize(rw, rh);
      camera.aspect = rw / rh;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(req);
      if (mountRef.current && renderer.domElement && mountRef.current.contains(renderer.domElement)) {
        mountRef.current.removeChild(renderer.domElement);
      }
      sphereGeometry.dispose();
      bridgeGeometries.forEach((bg) => bg.dispose());
      baseMaterial.dispose();
      bridgeMaterial.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div 
      ref={mountRef} 
      className={className}
      style={{ zIndex: 0, overflow: 'hidden', ...style }} 
    />
  );
}
