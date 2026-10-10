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
    camera.position.z = 35;

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

    const extrudeSettings = { depth: 2, bevelEnabled: true, bevelSegments: 3, steps: 2, bevelSize: 1.5, bevelThickness: 1.5 };
    const geometry = new THREE.ExtrudeGeometry( heartShape, extrudeSettings );
    
    // Center the geometry
    geometry.computeBoundingBox();
    const centerOffset = -0.5 * ( geometry.boundingBox.max.x - geometry.boundingBox.min.x );
    const centerOffsetY = -0.5 * ( geometry.boundingBox.max.y - geometry.boundingBox.min.y );
    geometry.translate( centerOffset, centerOffsetY, 0 );

    const material = new THREE.MeshPhysicalMaterial({
      color: 0xec4899,       // Pink/Red color
      emissive: 0xbe123c,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.85,
      roughness: 0.1,
      metalness: 0.1,
      transmission: 0.9,     // Glass-like
      thickness: 1.5
    });

    const heart = new THREE.Mesh(geometry, material);
    // The shape is drawn upside down, flip it
    heart.rotation.x = Math.PI;
    scene.add(heart);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const pointLight = new THREE.PointLight(0xffffff, 2, 100);
    pointLight.position.set(0, 10, 20);
    scene.add(pointLight);

    const backLight = new THREE.PointLight(0xf43f5e, 2, 100);
    backLight.position.set(0, -10, -20);
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

      // Beating effect (simulating a heartbeat pulse)
      // A typical heartbeat has a quick double pulse. 
      // Math.pow(Math.sin(time), 4) creates sharp peaks.
      const pulse = 1 + Math.pow(Math.sin(time * 1.5), 16) * 0.15;
      heart.scale.set(pulse, pulse, pulse);

      // Constant slow rotation
      heart.rotation.y += 0.005;

      // Mouse tracking rotation (spring physics)
      targetRotationY = mouseX * 0.6;
      targetRotationX = Math.PI + (mouseY * 0.4);

      // Smooth interpolation for mouse look
      heart.rotation.y += (targetRotationY - (heart.rotation.y % (Math.PI * 2))) * 0.05;
      // Keep x rotation around PI
      heart.rotation.x += (targetRotationX - heart.rotation.x) * 0.05;

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
      material.dispose();
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
