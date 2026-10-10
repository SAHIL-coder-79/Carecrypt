import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export function MedicalCross({ className = "absolute inset-0 pointer-events-none opacity-80", style = {} }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const w = mountRef.current.clientWidth;
    const h = mountRef.current.clientHeight;
    const scene = new THREE.Scene();
    
    // Camera
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    camera.position.z = 40;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountRef.current.appendChild(renderer.domElement);

    const group = new THREE.Group();

    // 1. Glowing Inner Core (Teal/Medical Green)
    const coreMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x0d9488,       // teal-600
      emissive: 0x0f766e,    // teal-700
      emissiveIntensity: 0.8,
      roughness: 0.2,
      metalness: 0.1
    });

    const crossShape = new THREE.Shape();
    // Draw a plus shape
    const s = 4; // size of arms
    const t = 1.5; // thickness of arms
    
    crossShape.moveTo(-t, -t);
    crossShape.lineTo(-s, -t);
    crossShape.lineTo(-s, t);
    crossShape.lineTo(-t, t);
    crossShape.lineTo(-t, s);
    crossShape.lineTo(t, s);
    crossShape.lineTo(t, t);
    crossShape.lineTo(s, t);
    crossShape.lineTo(s, -t);
    crossShape.lineTo(t, -t);
    crossShape.lineTo(t, -s);
    crossShape.lineTo(-t, -s);
    crossShape.lineTo(-t, -t);

    const extrudeSettings = { depth: 1, bevelEnabled: true, bevelSegments: 8, steps: 2, bevelSize: 0.8, bevelThickness: 0.8 };
    const geometry = new THREE.ExtrudeGeometry( crossShape, extrudeSettings );
    geometry.center();

    const core = new THREE.Mesh(geometry, coreMaterial);
    core.scale.set(0.85, 0.85, 0.85); // Slightly smaller inside
    group.add(core);

    // 2. Crystal Glass Shell
    const shellMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.95, // Glass effect
      opacity: 1,
      metalness: 0.2,
      roughness: 0.05,
      ior: 1.5,
      thickness: 2.0,
      specularIntensity: 1.0,
      clearcoat: 1.0,
      transparent: true
    });
    const shell = new THREE.Mesh(geometry, shellMaterial);
    group.add(shell);

    // Initial scale adjustment to fit sidebar
    group.scale.set(0.5, 0.5, 0.5);
    scene.add(group);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);
    
    const pointLight = new THREE.PointLight(0xffffff, 4, 100);
    pointLight.position.set(10, 20, 30);
    scene.add(pointLight);

    const backLight = new THREE.PointLight(0x14b8a6, 5, 100); // teal-500 backlight
    backLight.position.set(-10, -20, -30);
    scene.add(backLight);

    // Mouse tracking
    let targetRotationX = 0;
    let targetRotationY = 0;
    let mouseX = 0;
    let mouseY = 0;

    const onMouseMove = (event) => {
      const rect = mountRef.current.getBoundingClientRect();
      const clientX = event.clientX;
      const clientY = event.clientY;
      
      mouseX = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouseY = -((clientY - rect.top) / rect.height) * 2 + 1;
    };
    window.addEventListener('mousemove', onMouseMove);

    // Animation Loop
    let req;
    let time = 0;
    const animate = () => {
      req = requestAnimationFrame(animate);
      time += 0.02;

      // Floating effect
      group.position.y = Math.sin(time * 2) * 1.5;

      // Constant slow rotation
      group.rotation.y += 0.005;

      // Mouse tracking rotation (spring physics)
      targetRotationY = mouseX * 0.6;
      targetRotationX = mouseY * 0.4;

      // Smooth interpolation for mouse look
      group.rotation.y += (targetRotationY - (group.rotation.y % (Math.PI * 2))) * 0.05;
      group.rotation.x += (targetRotationX - group.rotation.x) * 0.05;

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
      geometry.dispose();
      coreMaterial.dispose();
      shellMaterial.dispose();
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
