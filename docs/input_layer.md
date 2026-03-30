To understand the input layer of Rebelle’s bristle engine, you have to look at it as a real-time physics simulation of a 3D object interacting with a textured surface, rather than a 2D cursor dragging a digital stamp. 

Here is a deeper technical breakdown of how the engine processes your stylus movements into physical bristle dynamics.

### 1. Data Acquisition and Stroke Interpolation
Before a single bristle moves, the engine must process the raw telemetry coming from your drawing tablet (via APIs like Windows Ink, Wintab, or Apple Pencil). 

* **High-Frequency Polling:** The engine constantly reads the stylus's X/Y coordinates, pressure, tilt (altitude and azimuth), and barrel rotation.
* **Spline Interpolation:** Because a user's hand often moves faster than the tablet's polling rate (which can cause jagged, straight lines between data points), the engine uses spline interpolation (typically Catmull-Rom or cubic Bezier curves) to predict and smooth the micro-trajectory of the stroke. 
* **Sub-Step Calculation:** To prevent bristles from "teleporting" across the canvas during fast strokes, the engine calculates multiple sub-steps between each actual tablet input frame, ensuring the physics simulation remains stable and continuous.

### 2. The Virtual Brush Morphology (3D Construction)
Unlike standard brushes that use a grayscale alpha shape, Rebelle constructs a mathematical, three-dimensional model of the brush head in memory.

* **Vector Arrays:** The brush is defined as an array of independent vectors (the bristles) attached to a central node (the ferrule/handle). 
* **Parameter Mapping:** Each bristle is assigned physical properties based on your brush settings: length, stiffness (spring constant), thickness, and density. 
* **Shape Generation:** Depending on whether you select a round, flat, or filbert brush, the engine distributes the origin points and lengths of these vectors to mimic that specific real-world geometry.

### 3. Kinematic Simulation (Deformation and Bending)
As you press and move the stylus, the engine calculates the physical deformation of the bristle array in real-time.

* **Spring Mechanics:** Each bristle acts as a structural spring. When you apply pressure (lowering the virtual brush toward the canvas), the bristles cannot pass through the canvas, so they bend. The engine uses inverse kinematics to calculate where the tip of each bristle should be based on the angle of the stylus and the resistance of the canvas.
* **Splaying and Clumping:** As pressure increases, the bristles are forced outward (splaying). However, this is counteracted by simulated capillary action—if the brush is loaded with wet oil or acrylic, surface tension causes the bristles to stick together in clumps. The engine constantly balances these opposing forces.
* **Directional Trailing:** Bristles inherently want to drag behind the direction of the stroke. If you sharply change direction, the engine calculates the lag time it takes for the flexible bristles to snap around and follow the new path, creating realistic twisting and cornering effects.

### 4. Surface Collision and Canvas Friction
The most computationally heavy part of the input layer is calculating how the bristles interact with the canvas texture.

* **Heightmap Raycasting:** The canvas in Rebelle is not flat; it has a topographical Z-depth heightmap (the paper or canvas grain). The engine constantly raycasts the tip of every single bristle against this heightmap.
* **Micro-Collisions:** If a bristle tip passes over a "valley" in the canvas texture and you are using light pressure, the bristle simply hovers over it, depositing no paint. If the bristle hits a "peak," a collision is registered, and the bristle bends further.
* **Friction Vectors:** The roughness of the canvas applies a drag coefficient to the bristles. A highly textured canvas will cause bristles to snag, separate, and jitter slightly, which creates the classic "dry brush" effect where paint skips across the surface.

### 5. Payload Transfer (Deposition)
Once a collision between a bristle tip and the canvas is confirmed, the payload transfer occurs, passing the data to the fluid simulation layer.

* **Individual Reservoirs:** Every bristle holds its own microscopic "reservoir" of paint, tracking its specific color, pigment volume, and wetness. 
* **Transfer Rate:** The rate at which the bristle empties its reservoir onto the canvas is determined by the applied pressure and the absorbency/friction of the canvas at that exact pixel.
* **Bi-directional Transfer (Dirtying):** Because it is a physical simulation, transfer works both ways. If a clean bristle drags through existing wet paint on the canvas, it picks that paint up, altering the bristle's payload and allowing you to drag that color further down the stroke.
