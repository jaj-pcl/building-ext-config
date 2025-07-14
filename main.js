import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// --- Global Three.js Variables ---
let scene, camera, renderer, controls;

// --- Data Structure for Multiple Buildings ---
window.buildings = [];
let currentBuildingId = null;
let nextBuildingIdCounter = 1;

// --- Conversion Factor ---
const M_TO_FEET = 3.28084;
const SQM_TO_SQFT = M_TO_FEET * M_TO_FEET;

// --- Arbitrary Cost Factors (per Square Meter) - Explicitly Defined ---
const FOUNDATION_COST_PER_SQM = 100;
const STRUCTURAL_COST_PER_SQM = 50;
const INTERIOR_FINISHES_COST_PER_SQM = 80;

// --- Default Floor Dimensions (in Feet) ---
const DEFAULT_FLOOR_HEIGHT_GLOBAL = 12 * M_TO_FEET;
const DEFAULT_BUILDING_LENGTH = 60 * M_TO_FEET;
const DEFAULT_BUILDING_DEPTH = 45 * M_TO_FEET;
const DEFAULT_GLOBAL_COMPLEXITY_FACTOR = 0; // New default for global complexity

// --- Default Building Parameters ---
const defaultBuildingParams = {
    shapeType: 'Box', // 'Box', 'C-Shape'
    numFloors: 3,
    floorDetails: [], // Array to hold {height, complexityFactorSource, complexityFactor} for each floor
    buildingLength: DEFAULT_BUILDING_LENGTH,
    buildingDepth: DEFAULT_BUILDING_DEPTH,
    typicalFloorHeight: DEFAULT_FLOOR_HEIGHT_GLOBAL,
    stepDirection: 'None', // 'None', 'Inward X', 'Inward Z', 'Outward X', 'Outward Z'
    stepAmount: 0 * M_TO_FEET,
    wallThickness: 5 * M_TO_FEET,
    globalComplexityFactor: DEFAULT_GLOBAL_COMPLEXITY_FACTOR, // Global complexity factor
    windowsPerFloor: 2,
    windowWidth: 1.0 * M_TO_FEET,
    windowHeight: 1.8 * M_TO_FEET,
    currentExteriorType: 'Punched Window',
};

// --- Fixed Building Constants ---
const roofThickness = 0.7 * M_TO_FEET;
const buildingSpacing = 100 * M_TO_FEET;

// --- Exterior Material Costs (per Square Foot) ---
const exteriorMaterialCosts = {
    'Curtain Wall': { costPerSqFt: 120.75, description: 'High-performance glass and aluminum facade.' },
    'Window Wall': { costPerSqFt: 89.25, description: 'Modular window units integrated with spandrel panels.' },
    'Punched Window': { costPerSqFt: 105.78, description: 'Individual windows within a solid wall system.' },
    'Metal Panel': { costPerSqFt: 100.93, description: 'Insulated metal panels, modern aesthetic.' },
    'Precast + Plaster': { costPerSqFt: 115.03, description: 'Precast concrete panels with a plaster finish, traditional look.' }
};

// --- Materials ---
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x383e42 }); // Dark Charcoal
const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 }); // Saddle Brown / Terracotta
const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xaed6f1, // Soft Sky Blue
    transparent: true,
    opacity: 0.6,
    roughness: 0.1,
    metalness: 0.0,
    ior: 1.5,
    thickness: 0.1
});

// --- Function to get the current wall material based on selected exterior type ---
function getWallMaterial(exteriorType) {
    let color;
    switch (exteriorType) {
        case 'Curtain Wall': color = 0xbdc3c7; break;
        case 'Window Wall': color = 0xaab7b8; break;
        case 'Punched Window': color = 0x708090; break;
        case 'Metal Panel': color = 0x4a4a4a; break;
        case 'Precast + Plaster': color = 0xdcdcdc; break;
        default: color = 0x708090;
    }
    return new THREE.MeshStandardMaterial({ color: color });
}

// --- Initialization Function ---
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe0e6eb);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(30 * M_TO_FEET, 30 * M_TO_FEET, 30 * M_TO_FEET);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50 * M_TO_FEET, 50 * M_TO_FEET, 50 * M_TO_FEET).normalize();
    scene.add(directionalLight);

    const groundGeometry = new THREE.PlaneGeometry(1000 * M_TO_FEET, 1000 * M_TO_FEET);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x7a8c88 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Attempt to load buildings from localStorage
    loadBuildingsFromLocalStorage();

    window.addEventListener('resize', onWindowResize, false);
    setupEventListeners();

    animate();
}

/**
 * Loads buildings from localStorage on initialization.
 */
function loadBuildingsFromLocalStorage() {
    try {
        const savedBuildings = localStorage.getItem('savedBuildings');
        if (savedBuildings) {
            const parsedBuildings = JSON.parse(savedBuildings);
            if (parsedBuildings.length > 0) {
                window.buildings = parsedBuildings.map(b => {
                    const buildingGroup = new THREE.Group();
                    buildingGroup.position.copy(new THREE.Vector3(b.position.x, b.position.y, b.position.z));
                    scene.add(buildingGroup);

                    // Ensure floorDetails have new complexity properties for older saved data
                    if (b.params && b.params.floorDetails) {
                        b.params.floorDetails = b.params.floorDetails.map(floor => ({
                            height: floor.height,
                            // If complexityFactor is explicitly 0 or a number, treat as custom_value
                            // Otherwise, default to global (null complexityFactor)
                            complexityFactorSource: (floor.complexityFactor !== undefined && floor.complexityFactor !== null) ? 'custom_value' : 'global',
                            complexityFactor: floor.complexityFactor !== undefined ? floor.complexityFactor : null
                        }));
                    }
                    if (b.params && b.params.globalComplexityFactor === undefined) {
                        b.params.globalComplexityFactor = DEFAULT_GLOBAL_COMPLEXITY_FACTOR;
                    }

                    return { ...b, group: buildingGroup };
                });
                // Find the highest ID to continue numbering
                nextBuildingIdCounter = Math.max(...window.buildings.map(b => parseInt(b.id.split('-')[1]))) + 1;
                updateBuildingSelector();
                selectBuilding(window.buildings[0].id); // Select the first loaded building
                console.log('Buildings loaded from localStorage successfully!');
                return;
            }
        }
    } catch (e) {
        console.error('Error loading buildings from localStorage:', e);
        // Clear corrupt data if any
        localStorage.removeItem('savedBuildings');
    }
    // If no buildings loaded or error, add a default one
    addBuilding();
}


/**
 * Creates a new building, adds it to the scene and the buildings array.
 * @param {object} [initialParams] - Optional parameters to override defaults.
 */
function addBuilding(initialParams = {}) {
    const buildingId = `building-${nextBuildingIdCounter++}`;
    const buildingName = `Building ${nextBuildingIdCounter - 1}`;

    const params = { ...defaultBuildingParams, ...initialParams };

    // Initialize floorDetails based on numFloors and typicalFloorHeight
    params.floorDetails = [];
    for (let i = 0; i < params.numFloors; i++) {
        let floorDefault = {
            height: params.typicalFloorHeight, // Use global typicalFloorHeight for initial value
            complexityFactorSource: 'global', // New floors default to using global
            complexityFactor: null // Null means use global, otherwise specific value
        };
        params.floorDetails.push(floorDefault);
    }

    const positionX = (window.buildings.length % 5) * buildingSpacing;
    const positionZ = Math.floor(window.buildings.length / 5) * buildingSpacing;
    const position = new THREE.Vector3(positionX, 0, positionZ);

    const buildingGroup = new THREE.Group();
    buildingGroup.position.copy(position);
    scene.add(buildingGroup);

    const newBuilding = {
        id: buildingId,
        name: buildingName,
        group: buildingGroup,
        params: params,
        position: position,
        calculatedMetrics: {
            exteriorArea: 0, // Total raw exterior wall area
            exteriorCost: 0, // Total exterior cost (with complexity)
            totalEstimatedCost: 0,
            totalPerimeter: 0, // This will be the ground floor perimeter
            perFloorPerimeters: [], // Store perimeter for each floor
            perFloorFootprintAreas: [], // Store footprint area for each floor
            perFloorRawWallAreas: [], // Store raw wall area for each floor
            perFloorDimensions: [] // Store calculated width/depth for each floor
        },
        snapshot: null
    };

    window.buildings.push(newBuilding);

    updateBuildingSelector();
    selectBuilding(buildingId);
}

/**
 * Selects a building by its ID, updates UI controls, and recenters camera.
 * @param {string} id - The ID of the building to select.
 */
function selectBuilding(id) {
    currentBuildingId = id;
    console.log('Selected Building ID:', currentBuildingId);

    const selectedBuilding = window.buildings.find(b => b.id === id);

    if (!selectedBuilding) {
        console.error(`Building with ID ${id} not found.`);
        return;
    }

    // Update global building parameters
    document.getElementById('buildingShape').value = selectedBuilding.params.shapeType;
    document.getElementById('numFloors').value = selectedBuilding.params.numFloors;
    document.getElementById('numFloorsValue').textContent = selectedBuilding.params.numFloors;

    document.getElementById('buildingLength').value = selectedBuilding.params.buildingLength.toFixed(1);
    document.getElementById('buildingLengthValue').textContent = selectedBuilding.params.buildingLength.toFixed(1);
    document.getElementById('buildingDepth').value = selectedBuilding.params.buildingDepth.toFixed(1);
    document.getElementById('buildingDepthValue').textContent = selectedBuilding.params.buildingDepth.toFixed(1);

    document.getElementById('typicalFloorHeightDefault').value = selectedBuilding.params.typicalFloorHeight.toFixed(1);
    document.getElementById('typicalFloorHeightDefaultValue').textContent = selectedBuilding.params.typicalFloorHeight.toFixed(1);
    document.getElementById('stepDirection').value = selectedBuilding.params.stepDirection;
    document.getElementById('stepAmount').value = selectedBuilding.params.stepAmount.toFixed(1);
    document.getElementById('stepAmountValue').textContent = selectedBuilding.params.stepAmount.toFixed(1);

    // Update global complexity factor
    document.getElementById('globalComplexityFactor').value = selectedBuilding.params.globalComplexityFactor;
    document.getElementById('globalComplexityFactorValue').textContent = selectedBuilding.params.globalComplexityFactor.toFixed(0);

    // Render individual floor inputs for height and complexity
    renderIndividualFloorInputs(selectedBuilding);

    // Update other global parameters
    document.getElementById('wallThickness').value = selectedBuilding.params.wallThickness.toFixed(2);
    document.getElementById('wallThicknessValue').textContent = selectedBuilding.params.wallThickness.toFixed(2);

    document.getElementById('exteriorType').value = selectedBuilding.params.currentExteriorType;
    document.getElementById('windowsPerFloor').value = selectedBuilding.params.windowsPerFloor;
    document.getElementById('windowsPerFloorValue').textContent = selectedBuilding.params.windowsPerFloor;
    document.getElementById('windowWidth').value = selectedBuilding.params.windowWidth;
    document.getElementById('windowWidthValue').textContent = selectedBuilding.params.windowWidth.toFixed(2);
    document.getElementById('windowHeight').value = selectedBuilding.params.windowHeight;
    document.getElementById('windowHeightValue').textContent = selectedBuilding.params.windowHeight.toFixed(2);

    document.getElementById('buildingSelector').value = id;

    const totalBuildingHeight = selectedBuilding.params.floorDetails.reduce((sum, floor) => sum + floor.height, 0);
    controls.target.set(
        selectedBuilding.position.x,
        selectedBuilding.position.y + totalBuildingHeight / 2,
        selectedBuilding.position.z
    );
    controls.update();

    drawBuilding(selectedBuilding);
}

/**
 * Deletes the currently selected building.
 */
function deleteSelectedBuilding() {
    if (!currentBuildingId) {
        console.warn('No building selected to delete.');
        return;
    }

    const index = window.buildings.findIndex(b => b.id === currentBuildingId);
    if (index !== -1) {
        const buildingToDelete = window.buildings[index];

        scene.remove(buildingToDelete.group);
        while (buildingToDelete.group.children.length > 0) {
            const child = buildingToDelete.group.children[0];
            buildingToDelete.group.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    if (child.material.dispose) child.material.dispose();
                }
            }
        }
        buildingToDelete.group.clear();
        buildingToDelete.group = null;

        window.buildings.splice(index, 1);

        updateBuildingSelector();

        if (window.buildings.length > 0) {
            selectBuilding(window.buildings[0].id);
        } else {
            currentBuildingId = null;
            clearUIControls();
        }
    }
}

/**
 * Updates the HTML select element with the list of buildings.
 */
function updateBuildingSelector() {
    const selector = document.getElementById('buildingSelector');
    selector.innerHTML = '';

    if (window.buildings.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No Buildings';
        option.disabled = true;
        option.selected = true;
        selector.appendChild(option);
        document.getElementById('deleteBuildingBtn').disabled = true;
        return;
    }

    document.getElementById('deleteBuildingBtn').disabled = false;

    window.buildings.forEach(building => {
        const option = document.createElement('option');
        option.value = building.id;
        option.textContent = building.name;
        selector.appendChild(option);
    });

    if (currentBuildingId && window.buildings.some(b => b.id === currentBuildingId)) {
        selector.value = currentBuildingId;
    } else if (window.buildings.length > 0) {
        selectBuilding(window.buildings[0].id);
    }
}

/**
 * Clears all UI controls. Called when no buildings are present.
 */
function clearUIControls() {
    document.getElementById('numFloors').value = defaultBuildingParams.numFloors;
    document.getElementById('numFloorsValue').textContent = defaultBuildingParams.numFloors;

    document.getElementById('buildingLength').value = defaultBuildingParams.buildingLength.toFixed(1);
    document.getElementById('buildingLengthValue').textContent = defaultBuildingParams.buildingLength.toFixed(1);
    document.getElementById('buildingDepth').value = defaultBuildingParams.buildingDepth.toFixed(1);
    document.getElementById('buildingDepthValue').textContent = defaultBuildingParams.buildingDepth.toFixed(1);

    document.getElementById('typicalFloorHeightDefault').value = defaultBuildingParams.typicalFloorHeight.toFixed(1);
    document.getElementById('typicalFloorHeightDefaultValue').textContent = defaultBuildingParams.typicalFloorHeight.toFixed(1);
    document.getElementById('stepDirection').value = defaultBuildingParams.stepDirection;
    document.getElementById('stepAmount').value = defaultBuildingParams.stepAmount.toFixed(1);
    document.getElementById('stepAmountValue').textContent = defaultBuildingParams.stepAmount.toFixed(1);

    document.getElementById('globalComplexityFactor').value = defaultBuildingParams.globalComplexityFactor;
    document.getElementById('globalComplexityFactorValue').textContent = defaultBuildingParams.globalComplexityFactor.toFixed(0);

    const individualFloorInputsDiv = document.getElementById('individualFloorInputs');
    individualFloorInputsDiv.innerHTML = ''; // Clear individual floor inputs

    document.getElementById('wallThickness').value = defaultBuildingParams.wallThickness.toFixed(2);
    document.getElementById('wallThicknessValue').textContent = defaultBuildingParams.wallThickness.toFixed(2);

    document.getElementById('exteriorType').value = defaultBuildingParams.currentExteriorType;
    document.getElementById('windowsPerFloor').value = defaultBuildingParams.windowsPerFloor;
    document.getElementById('windowsPerFloorValue').textContent = defaultBuildingParams.windowsPerFloor;
    document.getElementById('windowWidth').value = defaultBuildingParams.windowWidth.toFixed(2);
    document.getElementById('windowWidthValue').textContent = defaultBuildingParams.windowWidth.toFixed(2);
    document.getElementById('windowHeight').value = defaultBuildingParams.windowHeight.toFixed(2);
    document.getElementById('windowHeightValue').textContent = defaultBuildingParams.windowHeight.toFixed(2);

    document.getElementById('buildingShape').value = defaultBuildingParams.shapeType;
    document.getElementById('exteriorArea').textContent = '0.00';
    document.getElementById('exteriorCost').textContent = '0.00';
    document.getElementById('totalCost').textContent = '0.00';

    document.getElementById('userPerimeterInput').value = '0.00';
    document.getElementById('perimeterCheckStatus').textContent = '';
    document.getElementById('perimeterCheckStatus').classList.remove('perimeter-match', 'perimeter-mismatch');

    document.getElementById('perFloorDetailsOutput').innerHTML = '';
}

/**
 * Dynamically renders input fields for individual floor heights and complexity factors.
 * @param {object} building - The selected building object.
 */
function renderIndividualFloorInputs(building) {
    const individualFloorInputsDiv = document.getElementById('individualFloorInputs');
    individualFloorInputsDiv.innerHTML = '';

    const sectionLabel = document.createElement('h3');
    sectionLabel.textContent = 'Per-Floor Details:';
    individualFloorInputsDiv.appendChild(sectionLabel);

    building.params.floorDetails.forEach((floor, i) => {
        const floorNumber = i + 1;
        const floorDiv = document.createElement('div');
        floorDiv.classList.add('floor-input-group');
        floorDiv.innerHTML = `<h4>Floor ${floorNumber}</h4>`;

        // Height Input (per floor)
        const heightInput = createLabeledInput(
            `floorHeight_${i}`,
            `Height (ft):`,
            floor.height,
            'number',
            8.2, 88.6, 0.1
        );
        floorDiv.appendChild(heightInput.wrapper);
        heightInput.input.addEventListener('input', (event) => {
            const rawValue = event.target.value;
            let parsedValue = parseFloat(rawValue);
            if (isNaN(parsedValue) || rawValue === '') parsedValue = parseFloat(heightInput.input.min);
            if (parsedValue < parseFloat(heightInput.input.min)) parsedValue = parseFloat(heightInput.input.min);
            else if (parsedValue > parseFloat(heightInput.input.max)) parsedValue = parseFloat(heightInput.input.max);
            building.params.floorDetails[i].height = parsedValue;
            heightInput.valueSpan.textContent = parsedValue.toFixed(1);
            drawBuilding(building);
        });
        heightInput.input.addEventListener('blur', (event) => {
            let valueToFormat = parseFloat(event.target.value);
            if (isNaN(valueToFormat) || valueToFormat < parseFloat(heightInput.input.min)) valueToFormat = parseFloat(heightInput.input.min);
            else if (valueToFormat > parseFloat(heightInput.input.max)) valueToFormat = parseFloat(heightInput.input.max);
            event.target.value = valueToFormat.toFixed(1);
            building.params.floorDetails[i].height = valueToFormat;
            heightInput.valueSpan.textContent = valueToFormat.toFixed(1);
            drawBuilding(building);
        });

        // --- Complexity Factor Selector and Custom Input ---
        const complexityWrapper = document.createElement('div');
        complexityWrapper.classList.add('input-group');

        const complexityLabel = document.createElement('label');
        complexityLabel.htmlFor = `floorComplexitySelector_${i}`;
        complexityLabel.textContent = `Complexity Factor (Override):`;
        complexityWrapper.appendChild(complexityLabel);

        const complexitySelect = document.createElement('select');
        complexitySelect.id = `floorComplexitySelector_${i}`;
        const complexityOptions = [
            { value: 'global', text: 'Use Global' },
            { value: '0', text: '0%' },
            { value: '10', text: '10%' },
            { value: '25', text: '25%' },
            { value: '50', text: '50%' },
            { value: '75', text: '75%' },
            { value: '100', text: '100%' },
            { value: 'custom', text: 'Custom' }
        ];
        complexityOptions.forEach(optionData => {
            const option = document.createElement('option');
            option.value = optionData.value;
            option.textContent = optionData.text;
            complexitySelect.appendChild(option);
        });
        complexityWrapper.appendChild(complexitySelect);

        const customComplexityInput = document.createElement('input');
        customComplexityInput.type = 'number';
        customComplexityInput.id = `floorCustomComplexityInput_${i}`;
        customComplexityInput.min = '0';
        customComplexityInput.max = '100';
        customComplexityInput.step = '1';
        customComplexityInput.placeholder = 'Enter %';
        customComplexityInput.style.display = 'none'; // Hidden by default
        complexityWrapper.appendChild(customComplexityInput);

        const complexityValueSpan = document.createElement('span');
        complexityValueSpan.id = `floorComplexityValue_${i}`;
        complexityValueSpan.classList.add('complexity-value-span');
        complexityWrapper.appendChild(complexityValueSpan);

        // Set initial state based on floor's current complexityFactorSource and complexityFactor
        if (floor.complexityFactorSource === 'custom_value') { // Renamed from 'custom' to 'custom_value' for clarity
            complexitySelect.value = 'custom';
            customComplexityInput.style.display = 'inline-block';
            customComplexityInput.value = floor.complexityFactor !== null ? floor.complexityFactor.toFixed(0) : '';
        } else if (floor.complexityFactorSource === 'global') {
            complexitySelect.value = 'global';
        } else { // Presets (0, 10, 20 etc.)
            complexitySelect.value = String(floor.complexityFactor); // Convert number back to string for select value
        }
        updateComplexityValueDisplay(floor, building.params.globalComplexityFactor, complexityValueSpan);

        complexitySelect.addEventListener('change', (event) => {
            const selectedValue = event.target.value;
            if (selectedValue === 'custom') {
                customComplexityInput.style.display = 'inline-block';
                // If switching to custom, retain current numerical value or default to 0
                building.params.floorDetails[i].complexityFactor = building.params.floorDetails[i].complexityFactor !== null ? building.params.floorDetails[i].complexityFactor : 0;
                customComplexityInput.value = building.params.floorDetails[i].complexityFactor.toFixed(0);
                building.params.floorDetails[i].complexityFactorSource = 'custom_value'; // Updated source
            } else if (selectedValue === 'global') {
                customComplexityInput.style.display = 'none';
                building.params.floorDetails[i].complexityFactor = null; // Use null to indicate global
                building.params.floorDetails[i].complexityFactorSource = 'global';
            } else { // Preset numerical value
                customComplexityInput.style.display = 'none';
                building.params.floorDetails[i].complexityFactor = parseFloat(selectedValue);
                building.params.floorDetails[i].complexityFactorSource = 'preset'; // New source for presets
            }
            updateComplexityValueDisplay(floor, building.params.globalComplexityFactor, complexityValueSpan);
            drawBuilding(building);
        });

        customComplexityInput.addEventListener('input', (event) => {
            const rawValue = event.target.value;
            if (rawValue === '') {
                building.params.floorDetails[i].complexityFactor = 0; // Default to 0 if cleared
            } else {
                let parsedValue = parseFloat(rawValue);
                if (isNaN(parsedValue)) parsedValue = 0;
                if (parsedValue < 0) parsedValue = 0;
                else if (parsedValue > 100) parsedValue = 100;
                building.params.floorDetails[i].complexityFactor = parsedValue;
            }
            updateComplexityValueDisplay(floor, building.params.globalComplexityFactor, complexityValueSpan);
            drawBuilding(building);
        });

        customComplexityInput.addEventListener('blur', (event) => {
            let valueToFormat = parseFloat(event.target.value);
            if (isNaN(valueToFormat)) valueToFormat = 0;
            if (valueToFormat < 0) valueToFormat = 0;
            else if (valueToFormat > 100) valueToFormat = 100;
            event.target.value = valueToFormat.toFixed(0);
            building.params.floorDetails[i].complexityFactor = valueToFormat;
            updateComplexityValueDisplay(floor, building.params.globalComplexityFactor, complexityValueSpan);
            drawBuilding(building);
        });

        floorDiv.appendChild(complexityWrapper);
        // --- END NEW ---

        individualFloorInputsDiv.appendChild(floorDiv);
    });
}

/** Helper function to create labeled input groups dynamically */
function createLabeledInput(id, labelText, value, type, min, max, step) {
    const wrapper = document.createElement('div');
    wrapper.classList.add('input-group');

    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = labelText;
    wrapper.appendChild(label);

    const input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.min = min.toString();
    input.max = max.toString();
    input.step = step.toString();
    // Handle value display for number inputs, especially if value is empty/null
    input.value = (value === '' || value === null) ? '' : value.toFixed(type === 'number' ? (step === 1 ? 0 : 1) : 1);
    wrapper.appendChild(input);

    const valueSpan = document.createElement('span');
    valueSpan.id = `${id}Value`;
    valueSpan.textContent = (value === '' || value === null) ? '' : value.toFixed(type === 'number' ? (step === 1 ? 0 : 1) : 1);
    wrapper.appendChild(valueSpan);

    return { wrapper, input, valueSpan };
}

/** Helper function to update the displayed complexity value */
function updateComplexityValueDisplay(floor, globalComplexityFactor, spanElement) {
    if (floor.complexityFactorSource === 'global') {
        spanElement.textContent = `${globalComplexityFactor.toFixed(0)}% (Global)`;
    } else {
        spanElement.textContent = `${(floor.complexityFactor !== null ? floor.complexityFactor : 0).toFixed(0)}%`;
    }
}


/**
 * Draws or redraws a specific building's geometry within its THREE.Group.
 * @param {object} building - The building object to draw.
 */
function drawBuilding(building) {
    console.log('drawBuilding called for ID:', building ? building.id : 'N/A');
    try {
        if (!building || !building.group || !building.params) {
            console.error("Invalid building object provided to drawBuilding.");
            return;
        }

        const currentWallThickness = building.params.wallThickness;

        // Clear existing meshes
        while (building.group.children.length > 0) {
            const child = building.group.children[0];
            building.group.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    if (child.material.dispose) child.material.dispose();
                }
            }
        }

        const wallMaterial = getWallMaterial(building.params.currentExteriorType);
        let totalExteriorWallArea = 0; // Sum of raw wall areas for all floors
        let totalFloorAreaSum = 0; // Sum of footprint areas for all floors

        // Arrays to store per-floor metrics for cost calculation and display
        const perFloorRawWallAreas = [];
        const perFloorFootprintAreas = [];
        const perFloorPerimeters = [];
        const perFloorDimensions = []; // To store calculated width/depth for display

        let cumulativeHeight = 0;

        for (let i = 0; i < building.params.numFloors; i++) {
            const floor = building.params.floorDetails[i]; // Get per-floor height and complexity
            const floorHeight = floor.height;

            let currentFloorWidth = building.params.buildingLength;
            let currentFloorDepth = building.params.buildingDepth;

            // Apply stepping logic to calculate current floor's width and depth
            if (building.params.stepDirection !== 'None' && building.params.stepAmount !== 0) {
                const effectiveStepAmount = building.params.stepAmount * i; // Apply cumulatively based on floor index

                if (building.params.stepDirection === 'Inward X') {
                    currentFloorWidth = Math.max(currentWallThickness * 2, building.params.buildingLength - effectiveStepAmount * 2);
                } else if (building.params.stepDirection === 'Inward Z') {
                    currentFloorDepth = Math.max(currentWallThickness * 2, building.params.buildingDepth - effectiveStepAmount * 2);
                } else if (building.params.stepDirection === 'Outward X') {
                    currentFloorWidth = building.params.buildingLength + effectiveStepAmount * 2;
                } else if (building.params.stepDirection === 'Outward Z') {
                    currentFloorDepth = building.params.buildingDepth + effectiveStepAmount * 2;
                }
            }
            // Store the calculated dimensions for display
            perFloorDimensions.push({ width: currentFloorWidth, depth: currentFloorDepth });

            const floorY = cumulativeHeight;

            let currentFloorFootprintArea = 0;
            let currentFloorPerimeter = 0;
            let rawFloorWallArea = 0;

            // --- DRAWING AND AREA CALCULATION FOR CURRENT FLOOR ---
            if (building.params.shapeType === 'Box') {
                currentFloorFootprintArea = currentFloorWidth * currentFloorDepth;
                currentFloorPerimeter = 2 * (currentFloorWidth + currentFloorDepth);
                rawFloorWallArea = floorHeight * currentFloorPerimeter;

                const floorGeometry = new THREE.BoxGeometry(currentFloorWidth, currentWallThickness, currentFloorDepth);
                const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
                floorMesh.position.set(0, floorY + currentWallThickness / 2, 0); // Centered for now
                building.group.add(floorMesh);

                // Draw Walls
                const wallGeom = new THREE.BoxGeometry(currentFloorWidth, floorHeight, currentWallThickness);
                const sideWallGeom = new THREE.BoxGeometry(currentWallThickness, floorHeight, currentFloorDepth);

                const frontWall = new THREE.Mesh(wallGeom, wallMaterial);
                frontWall.position.set(0, floorY + floorHeight / 2, currentFloorDepth / 2 - currentWallThickness / 2);
                building.group.add(frontWall);
                const backWall = new THREE.Mesh(wallGeom, wallMaterial);
                backWall.position.set(0, floorY + floorHeight / 2, -currentFloorDepth / 2 + currentWallThickness / 2);
                building.group.add(backWall);
                const rightWall = new THREE.Mesh(sideWallGeom, wallMaterial);
                rightWall.position.set(currentFloorWidth / 2 - currentWallThickness / 2, floorY + floorHeight / 2, 0);
                building.group.add(rightWall);
                const leftWall = new THREE.Mesh(sideWallGeom, wallMaterial);
                leftWall.position.set(-currentFloorWidth / 2 + currentWallThickness / 2, floorY + floorHeight / 2, 0);
                building.group.add(leftWall);

            } else if (building.params.shapeType === 'C-Shape') {
                const C_W = currentFloorWidth;
                const C_D = currentFloorDepth;
                const C_T = currentWallThickness;

                // Ensure dimensions are valid for C-shape, prevent negative sizes for cutout
                const effectiveC_W = Math.max(C_T * 2, C_W); // Min width for arms to exist
                const effectiveC_D = Math.max(C_T * 2, C_D); // Min depth for arms to exist

                currentFloorFootprintArea = (effectiveC_W * effectiveC_D) - ((effectiveC_W - C_T * 2) * (effectiveC_D - C_T)); // Outer box minus inner void
                currentFloorPerimeter = (2 * effectiveC_W) + (4 * effectiveC_D) - (4 * C_T); // Simplified, needs precise calculation for C-shape
                rawFloorWallArea = floorHeight * currentFloorPerimeter;

                // Draw Floor Slabs for C-Shape
                const floorSpineGeometry = new THREE.BoxGeometry(effectiveC_W, currentWallThickness, C_T);
                const floorSpineMesh = new THREE.Mesh(floorSpineGeometry, floorMaterial);
                floorSpineMesh.position.set(0, floorY + currentWallThickness / 2, - effectiveC_D / 2 + C_T / 2);
                building.group.add(floorSpineMesh);

                const armDepth = effectiveC_D - C_T; // This is the length of the arm from the spine
                const floorArmGeometry = new THREE.BoxGeometry(C_T, currentWallThickness, armDepth);

                const floorTopArmMesh = new THREE.Mesh(floorArmGeometry, floorMaterial);
                floorTopArmMesh.position.set(
                    - (effectiveC_W / 2) + C_T / 2,
                    floorY + currentWallThickness / 2,
                    (armDepth / 2) - effectiveC_D / 2 + C_T
                );
                building.group.add(floorTopArmMesh);

                const floorBottomArmMesh = new THREE.Mesh(floorArmGeometry, floorMaterial);
                floorBottomArmMesh.position.set(
                    (effectiveC_W / 2) - C_T / 2,
                    floorY + currentWallThickness / 2,
                    (armDepth / 2) - effectiveC_D / 2 + C_T
                );
                building.group.add(floorBottomArmMesh);

                // Draw C-Shape Walls
                const spineWallGeom = new THREE.BoxGeometry(effectiveC_W, floorHeight, C_T);
                const armWallGeom = new THREE.BoxGeometry(C_T, floorHeight, armDepth);

                const frontSpineWall = new THREE.Mesh(spineWallGeom, wallMaterial);
                frontSpineWall.position.set(0, floorY + floorHeight / 2, -effectiveC_D / 2 + C_T / 2);
                building.group.add(frontSpineWall);

                const leftArmWall = new THREE.Mesh(armWallGeom, wallMaterial);
                leftArmWall.position.set(-effectiveC_W / 2 + C_T / 2, floorY + floorHeight / 2, (armDepth / 2) - effectiveC_D / 2 + C_T);
                building.group.add(leftArmWall);

                const rightArmWall = new THREE.Mesh(armWallGeom, wallMaterial);
                rightArmWall.position.set(effectiveC_W / 2 - C_T / 2, floorY + floorHeight / 2, (armDepth / 2) - effectiveC_D / 2 + C_T);
                building.group.add(rightArmWall);
            }

            // Accumulate total raw vertical wall area and footprint area
            totalExteriorWallArea += rawFloorWallArea;
            totalFloorAreaSum += currentFloorFootprintArea;

            // Store per-floor metrics
            perFloorRawWallAreas.push(rawFloorWallArea);
            perFloorFootprintAreas.push(currentFloorFootprintArea);
            perFloorPerimeters.push(currentFloorPerimeter);

            perFloorDimensions.push({ width: currentFloorWidth, depth: currentFloorDepth }); // Store calculated dimensions

            cumulativeHeight += floorHeight; // Update cumulative height for next floor
        }

        // --- Add a flat roof on the very top floor (using the final floor's calculated dimensions) ---
        const roofYPosition = cumulativeHeight; // Position the roof right on top of the last floor
        const topFloorIndex = building.params.numFloors - 1;
        
        let topFloorWidthAtRoof = building.params.buildingLength;
        let topFloorDepthAtRoof = building.params.buildingDepth;

        // Apply stepping logic for the roof dimensions based on the top floor's index
        if (building.params.stepDirection !== 'None' && building.params.stepAmount !== 0) {
            const effectiveStepAmount = building.params.stepAmount * topFloorIndex;
            if (building.params.stepDirection === 'Inward X') {
                topFloorWidthAtRoof = Math.max(currentWallThickness * 2, building.params.buildingLength - effectiveStepAmount * 2);
            } else if (building.params.stepDirection === 'Inward Z') {
                topFloorDepthAtRoof = Math.max(currentWallThickness * 2, building.params.buildingDepth - effectiveStepAmount * 2);
            } else if (building.params.stepDirection === 'Outward X') {
                topFloorWidthAtRoof = building.params.buildingLength + effectiveStepAmount * 2;
            } else if (building.params.stepDirection === 'Outward Z') {
                topFloorDepthAtRoof = building.params.buildingDepth + effectiveStepAmount * 2;
            }
        }


        if (building.params.shapeType === 'Box') {
            const roofGeometry = new THREE.BoxGeometry(topFloorWidthAtRoof, roofThickness, topFloorDepthAtRoof);
            const roofMesh = new THREE.Mesh(roofGeometry, roofMaterial);
            roofMesh.position.set(0, roofYPosition + roofThickness / 2, 0); // Use roofYPosition
            building.group.add(roofMesh);
        } else if (building.params.shapeType === 'C-Shape') {
            const C_W = topFloorWidthAtRoof;
            const C_D = topFloorDepthAtRoof;
            const C_T = currentWallThickness;
            const armDepth = C_D - C_T;

            // Ensure dimensions are valid for C-shape roof
            const effectiveC_W_roof = Math.max(C_T * 2, C_W);
            const effectiveC_D_roof = Math.max(C_T * 2, C_D);

            const roofSpineGeometry = new THREE.BoxGeometry(effectiveC_W_roof, roofThickness, C_T);
            const roofSpineMesh = new THREE.Mesh(roofSpineGeometry, roofMaterial);
            roofSpineMesh.position.set(0, roofYPosition + roofThickness / 2, - effectiveC_D_roof / 2 + C_T / 2);
            building.group.add(roofSpineMesh);

            const roofArmGeometry = new THREE.BoxGeometry(C_T, roofThickness, armDepth);
            const roofTopArmMesh = new THREE.Mesh(roofArmGeometry, roofMaterial);
            roofTopArmMesh.position.set(
                - (effectiveC_W_roof / 2) + C_T / 2,
                roofYPosition + roofThickness / 2,
                (armDepth / 2) - effectiveC_D_roof / 2 + C_T
            );
            building.group.add(roofTopArmMesh);

            const roofBottomArmMesh = new THREE.Mesh(roofArmGeometry, roofMaterial);
            roofBottomArmMesh.position.set(
                (effectiveC_W_roof / 2) - C_T / 2,
                roofYPosition + roofThickness / 2,
                (armDepth / 2) - effectiveC_D_roof / 2 + C_T
            );
            building.group.add(roofBottomArmMesh);
        }


        if (building.id === currentBuildingId) {
            // Update the stored totalPerimeter (ground floor perimeter)
            building.calculatedMetrics.totalPerimeter = perFloorPerimeters[0] || 0;
            building.calculatedMetrics.perFloorPerimeters = perFloorPerimeters; // Store all perimeters
            building.calculatedMetrics.perFloorFootprintAreas = perFloorFootprintAreas; // Store all footprint areas
            building.calculatedMetrics.perFloorRawWallAreas = perFloorRawWallAreas; // Store all raw wall areas
            building.calculatedMetrics.perFloorDimensions = perFloorDimensions; // Store all calculated dimensions

            updateCost(building); // Pass the entire building object for detailed cost calculation
            displayPerFloorDetails(building);
        }

        renderer.render(scene, camera);

        const canvas = renderer.domElement;
        try {
            building.snapshot = canvas.toDataURL('image/jpeg', 0.8);
        } catch (e) {
            console.error("Error capturing canvas snapshot:", e);
            building.snapshot = null;
        }
    } catch (error) {
        console.error("Critical error in drawBuilding:", error);
    }
}


// --- Cost Calculation Function (Now uses global or per-floor complexity) ---
function updateCost(building) {
    console.log('updateCost called.');
    try {
        if (!building) {
            console.warn("updateCost: No building selected or found, resetting display values.");
            document.getElementById('exteriorArea').textContent = '0.00';
            document.getElementById('exteriorCost').textContent = '0.00';
            document.getElementById('totalCost').textContent = '0.00';
            document.getElementById('userPerimeterInput').value = '0.00';
            document.getElementById('perimeterCheckStatus').textContent = '';
            document.getElementById('perimeterCheckStatus').classList.remove('perimeter-match', 'perimeter-mismatch');
            return;
        }

        let totalExteriorCost = 0;
        let totalStructuralCost = 0;
        let totalInteriorFinishesCost = 0;
        let totalRawExteriorAreaSum = 0; // For display

        const exteriorCostPerSqFt = exteriorMaterialCosts[building.params.currentExteriorType].costPerSqFt;
        const globalComplexityMultiplier = 1 + (building.params.globalComplexityFactor / 100);

        // Calculate costs per floor and sum them up
        building.params.floorDetails.forEach((floor, i) => {
            let effectiveFloorComplexityFactor;
            // Use per-floor complexity if source is custom_value or preset, otherwise use global
            if (floor.complexityFactorSource === 'custom_value' || floor.complexityFactorSource === 'preset') {
                effectiveFloorComplexityFactor = floor.complexityFactor !== null ? floor.complexityFactor : 0;
            } else { // 'global' or undefined/null source
                effectiveFloorComplexityFactor = building.params.globalComplexityFactor;
            }
            const floorComplexityMultiplier = 1 + (effectiveFloorComplexityFactor / 100);

            const floorRawWallArea = building.calculatedMetrics.perFloorRawWallAreas[i];
            const floorFootprintArea = building.calculatedMetrics.perFloorFootprintAreas[i];

            // Exterior Cost for this floor
            totalExteriorCost += floorRawWallArea * exteriorCostPerSqFt * floorComplexityMultiplier;

            // Structural Cost for this floor
            totalStructuralCost += floorFootprintArea * (STRUCTURAL_COST_PER_SQM / SQM_TO_SQFT) * floorComplexityMultiplier;

            // Interior Finishes Cost for this floor
            totalInteriorFinishesCost += floorFootprintArea * (INTERIOR_FINISHES_COST_PER_SQM / SQM_TO_SQFT) * floorComplexityMultiplier;

            totalRawExteriorAreaSum += floorRawWallArea; // Sum raw areas for display
        });

        // Foundation cost (only for ground floor footprint)
        let foundationFootprintArea = 0;
        if (building.params.floorDetails.length > 0) {
            foundationFootprintArea = building.calculatedMetrics.perFloorFootprintAreas[0]; // Ground floor footprint
        }
        // Foundation cost also influenced by global complexity, as it's a base cost
        const foundationCost = foundationFootprintArea * (FOUNDATION_COST_PER_SQM / SQM_TO_SQFT) * globalComplexityMultiplier;


        // Total estimated cost is sum of all costs
        let totalEstimatedCost = foundationCost + totalStructuralCost + totalInteriorFinishesCost + totalExteriorCost;

        // Update calculated metrics in the building object
        building.calculatedMetrics.exteriorArea = totalRawExteriorAreaSum;
        building.calculatedMetrics.exteriorCost = totalExteriorCost;
        building.calculatedMetrics.totalEstimatedCost = totalEstimatedCost;

        // Update UI displays
        document.getElementById('exteriorArea').textContent = totalRawExteriorAreaSum.toFixed(2);
        document.getElementById('exteriorCost').textContent = totalExteriorCost.toFixed(2);
        document.getElementById('totalCost').textContent = Math.ceil(totalEstimatedCost).toLocaleString('en-US');

        document.getElementById('userPerimeterInput').value = building.calculatedMetrics.totalPerimeter.toFixed(2);
        checkPerimeterMatch();
    } catch (error) {
        console.error("Error in updateCost:", error);
    }
}

/**
 * Checks if the user's input perimeter matches the calculated perimeter.
 */
function checkPerimeterMatch() {
    const selectedBuilding = window.buildings.find(b => b.id === currentBuildingId);
    const userPerimeterInput = document.getElementById('userPerimeterInput');
    const perimeterCheckStatus = document.getElementById('perimeterCheckStatus');

    if (!selectedBuilding || !userPerimeterInput || !perimeterCheckStatus) return;

    const userValue = parseFloat(userPerimeterInput.value);
    const calculatedValue = selectedBuilding.calculatedMetrics.totalPerimeter;
    const tolerance = 0.01;

    perimeterCheckStatus.classList.remove('perimeter-match', 'perimeter-mismatch');

    if (isNaN(userValue)) {
        perimeterCheckStatus.textContent = '';
    } else if (Math.abs(userValue - calculatedValue) < tolerance) {
        perimeterCheckStatus.textContent = 'Matches calculated!';
        perimeterCheckStatus.classList.add('perimeter-match');
    } else {
        perimeterCheckStatus.textContent = `Mismatch! Calculated: ${calculatedValue.toFixed(2)} ft`;
        perimeterCheckStatus.classList.add('perimeter-mismatch');
    }
}

/**
 * Displays per-floor calculated details (perimeter, footprint area, raw wall area, and dimensions).
 */
function displayPerFloorDetails(building) {
    const outputDiv = document.getElementById('perFloorDetailsOutput');
    outputDiv.innerHTML = ''; // Clear previous content

    if (building.calculatedMetrics.perFloorPerimeters.length === 0) {
        outputDiv.textContent = 'No per-floor details to display.';
        return;
    }

    const title = document.createElement('h3');
    title.textContent = 'Per-Floor Metrics:';
    outputDiv.appendChild(title);

    building.params.floorDetails.forEach((floor, i) => {
        const floorNumber = i + 1;
        const floorDetailsItem = document.createElement('div');
        floorDetailsItem.classList.add('floor-details-item');

        const perimeter = building.calculatedMetrics.perFloorPerimeters[i] !== undefined ? building.calculatedMetrics.perFloorPerimeters[i].toFixed(2) : 'N/A';
        const footprintArea = building.calculatedMetrics.perFloorFootprintAreas[i] !== undefined ? building.calculatedMetrics.perFloorFootprintAreas[i].toFixed(2) : 'N/A';
        const rawWallArea = building.calculatedMetrics.perFloorRawWallAreas[i] !== undefined ? building.calculatedMetrics.perFloorRawWallAreas[i].toFixed(2) : 'N/A';
        
        const floorDimensions = building.calculatedMetrics.perFloorDimensions[i];
        const dimensionsString = floorDimensions ? `W: ${floorDimensions.width.toFixed(1)}ft, D: ${floorDimensions.depth.toFixed(1)}ft` : 'N/A';

        // Determine which complexity factor to display in summary
        let displayedComplexity;
        if (floor.complexityFactorSource === 'global') {
            displayedComplexity = `${building.params.globalComplexityFactor.toFixed(0)}% (Global)`;
        } else {
            displayedComplexity = `${(floor.complexityFactor !== null ? floor.complexityFactor : 0).toFixed(0)}% (Override)`;
        }

        floorDetailsItem.innerHTML = `
            <strong>Floor ${floorNumber}:</strong> (H: ${floor.height.toFixed(1)}ft, ${dimensionsString}, Comp: ${displayedComplexity})<br>
            Perimeter: ${perimeter} ft | Footprint Area: ${footprintArea} sq ft | Raw Wall Area: ${rawWallArea} sq ft<br>
        `;
        outputDiv.appendChild(floorDetailsItem);
    });
}


// --- UI Event Listeners Setup ---
function setupEventListeners() {
    document.getElementById('addBuildingBtn').addEventListener('click', addBuilding);
    document.getElementById('deleteBuildingBtn').addEventListener('click', deleteSelectedBuilding);
    document.getElementById('buildingSelector').addEventListener('change', (event) => {
        selectBuilding(event.target.value);
    });

    const buildingShapeDropdown = document.getElementById('buildingShape');
    const numFloorsInput = document.getElementById('numFloors');
    const numFloorsValueSpan = document.getElementById('numFloorsValue');
    const buildingLengthInput = document.getElementById('buildingLength');
    const buildingLengthValueSpan = document.getElementById('buildingLengthValue');
    const buildingDepthInput = document.getElementById('buildingDepth');
    const buildingDepthValueSpan = document.getElementById('buildingDepthValue');
    const typicalFloorHeightDefaultInput = document.getElementById('typicalFloorHeightDefault');
    const typicalFloorHeightDefaultValueSpan = document.getElementById('typicalFloorHeightDefaultValue');
    const stepDirectionDropdown = document.getElementById('stepDirection');
    const stepAmountInput = document.getElementById('stepAmount');
    const stepAmountValueSpan = document.getElementById('stepAmountValue');
    const wallThicknessInput = document.getElementById('wallThickness');
    const wallThicknessValueSpan = document.getElementById('wallThicknessValue');
    const globalComplexityFactorInput = document.getElementById('globalComplexityFactor'); // Global complexity
    const globalComplexityFactorValueSpan = document.getElementById('globalComplexityFactorValue'); // Global complexity
    const exteriorTypeDropdown = document.getElementById('exteriorType');
    const windowsPerFloorInput = document.getElementById('windowsPerFloor');
    const windowsPerFloorValueSpan = document.getElementById('windowsPerFloorValue');
    const windowWidthInput = document.getElementById('windowWidth');
    const windowWidthValueSpan = document.getElementById('windowWidthValue');
    const windowHeightInput = document.getElementById('windowHeight');
    const windowHeightValueSpan = document.getElementById('windowHeightValue');
    const userPerimeterInput = document.getElementById('userPerimeterInput');


    buildingShapeDropdown.addEventListener('change', (event) => {
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            building.params.shapeType = event.target.value;
            drawBuilding(building);
        }
    });

    numFloorsInput.addEventListener('change', (event) => {
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            const inputValueString = event.target.value;
            let newNumFloors = parseInt(inputValueString);

            if (isNaN(newNumFloors) || inputValueString === '') {
                newNumFloors = parseInt(event.target.min);
            }

            const min = parseInt(event.target.min);
            const max = parseInt(event.target.max);
            if (newNumFloors < min) {
                newNumFloors = min;
            } else if (newNumFloors > max) {
                newNumFloors = max;
            }

            event.target.value = newNumFloors;

            if (building.params.numFloors !== newNumFloors) {
                if (newNumFloors > building.params.floorDetails.length) {
                    for (let i = building.params.floorDetails.length; i < newNumFloors; i++) {
                        let floorDefault = {
                            height: building.params.typicalFloorHeight, // Use current typical floor height for new floors
                            complexityFactorSource: 'global', // New floors default to global
                            complexityFactor: null // Null to indicate using global
                        };
                        building.params.floorDetails.push(floorDefault);
                    }
                } else if (newNumFloors < building.params.floorDetails.length) {
                    building.params.floorDetails.length = newNumFloors;
                }

                building.params.numFloors = newNumFloors;
                numFloorsValueSpan.textContent = building.params.numFloors;

                renderIndividualFloorInputs(building); // Re-render all floor inputs
                drawBuilding(building);
            }
        }
    });

    // Event listeners for global building dimensions and stepping
    buildingLengthInput.addEventListener('input', (event) => {
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            const rawValue = event.target.value;
            let parsedValue = parseFloat(rawValue);
            if (isNaN(parsedValue) || rawValue === '') parsedValue = parseFloat(event.target.min);
            if (parsedValue < parseFloat(event.target.min)) parsedValue = parseFloat(event.target.min);
            else if (parsedValue > parseFloat(event.target.max)) parsedValue = parseFloat(event.target.max);
            building.params.buildingLength = parsedValue;
            buildingLengthValueSpan.textContent = parsedValue.toFixed(1);
            drawBuilding(building);
        }
    });
    buildingLengthInput.addEventListener('blur', (event) => {
        let valueToFormat = parseFloat(event.target.value);
        if (isNaN(valueToFormat) || valueToFormat < parseFloat(event.target.min)) valueToFormat = parseFloat(event.target.min);
        else if (valueToFormat > parseFloat(event.target.max)) valueToFormat = parseFloat(event.target.max);
        event.target.value = valueToFormat.toFixed(1);
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) { building.params.buildingLength = valueToFormat; drawBuilding(building); }
    });

    buildingDepthInput.addEventListener('input', (event) => {
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            const rawValue = event.target.value;
            let parsedValue = parseFloat(rawValue);
            if (isNaN(parsedValue) || rawValue === '') parsedValue = parseFloat(event.target.min);
            if (parsedValue < parseFloat(event.target.min)) parsedValue = parseFloat(event.target.min);
            else if (parsedValue > parseFloat(event.target.max)) parsedValue = parseFloat(event.target.max);
            building.params.buildingDepth = parsedValue;
            buildingDepthValueSpan.textContent = parsedValue.toFixed(1);
            drawBuilding(building);
        }
    });
    buildingDepthInput.addEventListener('blur', (event) => {
        let valueToFormat = parseFloat(event.target.value);
        if (isNaN(valueToFormat) || valueToFormat < parseFloat(event.target.min)) valueToFormat = parseFloat(event.target.min);
        else if (valueToFormat > parseFloat(event.target.max)) valueToFormat = parseFloat(event.target.max);
        event.target.value = valueToFormat.toFixed(1);
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) { building.params.buildingDepth = valueToFormat; drawBuilding(building); }
    });

    typicalFloorHeightDefaultInput.addEventListener('input', (event) => {
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            const rawValue = event.target.value;
            let parsedValue = parseFloat(rawValue);
            if (isNaN(parsedValue) || rawValue === '') parsedValue = parseFloat(event.target.min);
            if (parsedValue < parseFloat(event.target.min)) parsedValue = parseFloat(event.target.min);
            else if (parsedValue > parseFloat(event.target.max)) parsedValue = parseFloat(event.target.max);
            building.params.typicalFloorHeight = parsedValue;
            typicalFloorHeightDefaultValueSpan.textContent = parsedValue.toFixed(1);
            // Update only floors that are currently at the default height or have not been manually set
            building.params.floorDetails.forEach(f => {
                if (Math.abs(f.height - building.params.typicalFloorHeight) < 0.01 || f.height === DEFAULT_FLOOR_HEIGHT_GLOBAL) {
                    f.height = parsedValue;
                }
            });
            renderIndividualFloorInputs(building); // Re-render to show updated heights
            drawBuilding(building);
        }
    });
    typicalFloorHeightDefaultInput.addEventListener('blur', (event) => {
        let valueToFormat = parseFloat(event.target.value);
        if (isNaN(valueToFormat) || valueToFormat < parseFloat(event.target.min)) valueToFormat = parseFloat(event.target.min);
        else if (valueToFormat > parseFloat(event.target.max)) valueToFormat = parseFloat(event.target.max);
        event.target.value = valueToFormat.toFixed(1);
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            building.params.typicalFloorHeight = valueToFormat;
            building.params.floorDetails.forEach(f => {
                if (Math.abs(f.height - building.params.typicalFloorHeight) < 0.01 || f.height === DEFAULT_FLOOR_HEIGHT_GLOBAL) {
                    f.height = valueToFormat;
                }
            });
            renderIndividualFloorInputs(building);
            drawBuilding(building);
        }
    });

    stepDirectionDropdown.addEventListener('change', (event) => {
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            building.params.stepDirection = event.target.value;
            drawBuilding(building);
        }
    });

    stepAmountInput.addEventListener('input', (event) => {
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            const rawValue = event.target.value;
            let parsedValue = parseFloat(rawValue);
            if (isNaN(parsedValue) || rawValue === '') parsedValue = parseFloat(event.target.min);
            if (parsedValue < parseFloat(event.target.min)) parsedValue = parseFloat(event.target.min);
            else if (parsedValue > parseFloat(event.target.max)) parsedValue = parseFloat(event.target.max);
            building.params.stepAmount = parsedValue;
            stepAmountValueSpan.textContent = parsedValue.toFixed(1);
            drawBuilding(building);
        }
    });
    stepAmountInput.addEventListener('blur', (event) => {
        let valueToFormat = parseFloat(event.target.value);
        if (isNaN(valueToFormat) || valueToFormat < parseFloat(event.target.min)) valueToFormat = parseFloat(event.target.min);
        else if (valueToFormat > parseFloat(event.target.max)) valueToFormat = parseFloat(event.target.max);
        event.target.value = valueToFormat.toFixed(1);
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) { building.params.stepAmount = valueToFormat; drawBuilding(building); }
    });


    wallThicknessInput.addEventListener('input', (event) => {
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            const rawValue = event.target.value;
            let parsedValue = parseFloat(rawValue);
            if (isNaN(parsedValue) || rawValue === '') parsedValue = parseFloat(event.target.min);
            if (parsedValue < parseFloat(event.target.min)) parsedValue = parseFloat(event.target.min);
            else if (parsedValue > parseFloat(event.target.max)) parsedValue = parseFloat(event.target.max);

            building.params.wallThickness = parsedValue;
            wallThicknessValueSpan.textContent = parsedValue.toFixed(2);
            drawBuilding(building);
        }
    });
    wallThicknessInput.addEventListener('blur', (event) => {
        let valueToFormat = parseFloat(event.target.value);
        if (isNaN(valueToFormat) || valueToFormat < parseFloat(event.target.min)) valueToFormat = parseFloat(event.target.min);
        else if (valueToFormat > parseFloat(event.target.max)) valueToFormat = parseFloat(event.target.max);
        event.target.value = valueToFormat.toFixed(2);
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            building.params.wallThickness = valueToFormat;
            wallThicknessValueSpan.textContent = valueToFormat.toFixed(2);
            drawBuilding(building);
        }
    });

    // Global Complexity Factor Listener
    globalComplexityFactorInput.addEventListener('input', (event) => {
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            const rawValue = event.target.value;
            let parsedValue = parseFloat(rawValue);
            if (isNaN(parsedValue) || rawValue === '') parsedValue = parseFloat(event.target.min);
            if (parsedValue < parseFloat(event.target.min)) parsedValue = parseFloat(event.target.min);
            else if (parsedValue > parseFloat(event.target.max)) parsedValue = parseFloat(event.target.max);
            
            building.params.globalComplexityFactor = parsedValue;
            globalComplexityFactorValueSpan.textContent = parsedValue.toFixed(0);

            // Re-render individual floor inputs to update their 'Global' display
            renderIndividualFloorInputs(building);
            drawBuilding(building);
        }
    });
    globalComplexityFactorInput.addEventListener('blur', (event) => {
        let valueToFormat = parseFloat(event.target.value);
        if (isNaN(valueToFormat) || valueToFormat < parseFloat(event.target.min)) valueToFormat = parseFloat(event.target.min);
        else if (valueToFormat > parseFloat(event.target.max)) valueToFormat = parseFloat(event.target.max);
        event.target.value = valueToFormat.toFixed(0);
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            building.params.globalComplexityFactor = valueToFormat;
            globalComplexityFactorValueSpan.textContent = valueToFormat.toFixed(0);
            renderIndividualFloorInputs(building);
            drawBuilding(building);
        }
    });


    exteriorTypeDropdown.addEventListener('change', (event) => {
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            building.params.currentExteriorType = event.target.value;
            drawBuilding(building);
        }
    });

    windowsPerFloorInput.addEventListener('input', (event) => {
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            const rawValue = event.target.value;
            let parsedValue = parseInt(rawValue);
            if (isNaN(parsedValue) || rawValue === '') parsedValue = parseInt(event.target.min);
            if (parsedValue < parseInt(event.target.min)) parsedValue = parseInt(event.target.max); // Corrected max check
            else if (parsedValue > parseInt(event.target.max)) parsedValue = parseInt(event.target.max); // Corrected max check

            building.params.windowsPerFloor = parsedValue;
            windowsPerFloorValueSpan.textContent = parsedValue;
            drawBuilding(building);
        }
    });
    windowsPerFloorInput.addEventListener('blur', (event) => {
        let valueToFormat = parseInt(event.target.value);
        if (isNaN(valueToFormat) || valueToFormat < parseInt(event.target.min)) valueToFormat = parseInt(event.target.min);
        else if (valueToFormat > parseInt(event.target.max)) valueToFormat = parseInt(event.target.max);
        event.target.value = valueToFormat;
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            building.params.windowsPerFloor = valueToFormat;
            windowsPerFloorValueSpan.textContent = valueToFormat;
            drawBuilding(building);
        }
    });


    windowWidthInput.addEventListener('input', (event) => {
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            const rawValue = event.target.value;
            let parsedValue = parseFloat(rawValue);
            if (isNaN(parsedValue) || rawValue === '') parsedValue = parseFloat(event.target.min);
            if (parsedValue < parseFloat(event.target.min)) parsedValue = parseFloat(event.target.min);
            else if (parsedValue > parseFloat(event.target.max)) parsedValue = parseFloat(event.target.max);

            building.params.windowWidth = parsedValue;
            windowWidthValueSpan.textContent = parsedValue.toFixed(2);
            drawBuilding(building);
        }
    });
    windowWidthInput.addEventListener('blur', (event) => {
        let valueToFormat = parseFloat(event.target.value);
        if (isNaN(valueToFormat) || valueToFormat < parseFloat(event.target.min)) valueToFormat = parseFloat(event.target.min);
        else if (valueToFormat > parseFloat(event.target.max)) valueToFormat = parseFloat(event.target.max);
        event.target.value = valueToFormat.toFixed(2);
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            building.params.windowWidth = valueToFormat;
            windowWidthValueSpan.textContent = valueToFormat.toFixed(2);
            drawBuilding(building);
        }
    });


    windowHeightInput.addEventListener('input', (event) => {
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            const rawValue = event.target.value;
            let parsedValue = parseFloat(rawValue);
            if (isNaN(parsedValue) || rawValue === '') parsedValue = parseFloat(event.target.min);
            if (parsedValue < parseFloat(event.target.min)) parsedValue = parseFloat(event.target.min);
            else if (parsedValue > parseFloat(event.target.max)) parsedValue = parseFloat(event.target.max);

            building.params.windowHeight = parsedValue;
            windowHeightValueSpan.textContent = parsedValue.toFixed(2);
            drawBuilding(building);
        }
    });
    windowHeightInput.addEventListener('blur', (event) => {
        let valueToFormat = parseFloat(event.target.value);
        if (isNaN(valueToFormat) || valueToFormat < parseFloat(event.target.min)) valueToFormat = parseFloat(event.target.min);
        else if (valueToFormat > parseFloat(event.target.max)) valueToFormat = parseFloat(event.target.max);
        event.target.value = valueToFormat.toFixed(2);
        const building = window.buildings.find(b => b.id === currentBuildingId);
        if (building) {
            building.params.windowHeight = valueToFormat;
            windowHeightValueSpan.textContent = valueToFormat.toFixed(2);
            drawBuilding(building);
        }
    });

    userPerimeterInput.addEventListener('input', checkPerimeterMatch);
    userPerimeterInput.addEventListener('blur', (event) => {
        let valueToFormat = parseFloat(event.target.value);
        if (isNaN(valueToFormat)) {
            valueToFormat = 0;
        }
        event.target.value = valueToFormat.toFixed(2);
        checkPerimeterMatch();
    });
}

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// --- Window Resize Handler ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Initialize the application when the DOM content is fully loaded
document.addEventListener('DOMContentLoaded', init);
