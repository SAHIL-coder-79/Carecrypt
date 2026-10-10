import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export function BeatingHeart({ className = "absolute inset-0 pointer-events-none opacity-80", style = {} }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const w = mountRef.current.clientWidth;
    const h = mountRef.current.clientHeight;
    const scene = new THREE.Scene();
    
    // Camera
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    camera.position.z = 60;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountRef.current.appendChild(renderer.domElement);

    // Heart Shape
    const x = 0, y = 0;
    const heartShape = new THREE.Shape();
    heartShape.moveTo( x + 5, y + 5 );
    heartShape.bezierCurveTo( x + 5, y + 5, x + 4, y, x, y );
    heartShape.bezierCurveTo( x - 6, y, x - 6, y + 7, x - 6, y + 7 );
    heartShape.bezierCurveTo( x - 6, y + 11, x - 3, y + 15.4, x + 5, y + 19 );
    heartShape.bezierCurveTo( x + 12, y + 15.4, x + 16, y + 11, x + 16, y + 7 );
    heartShape.bezierCurveTo( x + 16, y + 7, x + 16, y, x + 10, y );
    heartShape.bezierCurveTo( x + 7, y, x + 5, y + 5, x + 5, y + 5 );

    const extrudeSettings = { depth: 1, bevelEnabled: true, bevelSegments: 8, steps: 2, bevelSize: 2, bevelThickness: 2 };
    const geometry = new THREE.ExtrudeGeometry( heartShape, extrudeSettings );
    
    // Center the geometry
    geometry.computeBoundingBox();
    const centerOffset = -0.5 * ( geometry.boundingBox.max.x - geometry.boundingBox.min.x );
    const centerOffsetY = -0.5 * ( geometry.boundingBox.max.y - geometry.boundingBox.min.y );
    geometry.translate( centerOffset, centerOffsetY, 0 );

    const group = new THREE.Group();

    // 1. Glowing Inner Core
    const coreMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xff0055,
      emissive: 0x9f1239,
      emissiveIntensity: 0.8,
      roughness: 0.2,
      metalness: 0.1
    });
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

    // The shape is drawn upside down, flip it
    group.rotation.x = Math.PI;
    scene.add(group);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);
    
    const pointLight = new THREE.PointLight(0xffffff, 4, 100);
    pointLight.position.set(10, 20, 30);
    scene.add(pointLight);

    const backLight = new THREE.PointLight(0xf43f5e, 5, 100);
    backLight.position.set(-10, -20, -30);
    scene.add(backLight);

    // Mouse tracking
    let targetRotationX = Math.PI;
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
      time += 0.05;

      // Beating effect
      const pulse = 0.4 + Math.pow(Math.sin(time * 1.5), 16) * 0.08;
      group.scale.set(pulse, pulse, pulse);

      // Constant slow rotation
      group.rotation.y += 0.005;

      // Mouse tracking rotation (spring physics)
      targetRotationY = mouseX * 0.6;
      targetRotationX = Math.PI + (mouseY * 0.4);

      // Smooth interpolation for mouse look
      group.rotation.y += (targetRotationY - (group.rotation.y % (Math.PI * 2))) * 0.05;
      // Keep x rotation around PI
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
