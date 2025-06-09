function makeIdentityMatrix() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function makeTranslationMatrix(tx, ty) {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    tx, ty, 0, 1,
  ])
}

function makeRotationMatrix(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([
    c,  s, 0, 0,
   -s,  c, 0, 0,
    0,  0, 1, 0,
    0,  0, 0, 1,
  ]);
}

function multiplyMatrices(a, b) {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; ++row) {
    for (let col = 0; col < 4; ++col) {
      out[4 * col + row] =
        a[row + 0] * b[4 * col + 0] +
        a[row + 4] * b[4 * col + 1] +
        a[row + 8] * b[4 * col + 2] +
        a[row + 12] * b[4 * col + 3];
    }
  }
  return out;
}

async function main()
{
  // get webgpu adapter and device
  const adaptor = await navigator.gpu?.requestAdapter();
  const device = await adaptor?.requestDevice();
  if (!device) {
    fail('your browser does not support WebGPU');
    return;
  }

  // create a webgpu context with the canvas
  const canvas = document.getElementById("webgpu-canvas");
  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({device, format});

  // vertex and fragment shaders (in one single module)
  const module = device.createShaderModule({
    label: 'moving the square',
    code: `
      struct Uniforms{
        M: mat4x4<f32>, // model matrix
      };
      @group(0) @binding(0) var<uniform> uniforms : Uniforms;

      struct VSIn {
        @location(0) pos : vec2f,
        @location(1) color : vec4f,
      };

      struct VSOut {
        @builtin(position) pos : vec4f,
        @location(0) color : vec4f,
      };

      @vertex fn vs(in : VSIn) -> VSOut
      {
        var out : VSOut;
        out.pos = uniforms.M * vec4f(in.pos, 0.0, 1.0);
        out.color = in.color;
        return out;
      }

      @fragment fn fs(vsOut : VSOut) -> @location(0) vec4f 
      {
        return vsOut.color;
      }
    `,
  });

  // the rendering pipeline
  const pipeline = device.createRenderPipeline({
    label: 'vertex buffer triangle pipeline',
    layout: 'auto',
    vertex: {
      entryPoint: 'vs',
      module: module, 
      buffers: [
        { 
          arrayStride: 5 * 4, // 5 floating-point numbers with 4 bytes each
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: 'float32x2',
            },
            {
              shaderLocation: 1,
              offset: 2 * 4, // the offset is two floating-point numbers
              format: 'float32x3',
            }
          ]
        },
      ],
    },
    fragment: {
      entryPoint: 'fs',
      module: module,
      targets: [{ format: format }],
    },
  });

  // status for the rotation and translation control
  let tx = 0, ty = 0, angle = 0; // status for the translation and rotation
  let useRotationTimesTranslation = true;
  const radioRT = document.getElementById('radio-rt');
  const radioTR = document.getElementById('radio-tr');
  radioRT.onchange = () => { useRotationTimesTranslation = true; updateMatrixAndRender(); }
  radioTR.onchange = () => { useRotationTimesTranslation = false; updateMatrixAndRender(); }
  
  // the uniform variable for the matrix
  let matrix = makeIdentityMatrix(); // no translation/rotation at the beginning
  const uniformBuffer = device.createBuffer({
    size: 16 * 4, // 4x4 matrix of f32
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, matrix);

  // bind group for uniform variables
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: { buffer: uniformBuffer },
      },
    ],
  });

  // vertex position and color data in one buffer, now removed 
  const vertexData = new Float32Array([
    -0.5, -0.5, 1.0, 0.0, 0.0, 
    0.5,  -0.5, 0.0, 1.0, 0.0,
    0.5,   0.5, 0.0, 0.0, 1.0,
    -0.5,  0.5, 1.0, 1.0, 0.0,
  ]);

  // here goes the indices for the two triangles
  const indexData = new Uint32Array([
    0, 1, 2, // first triangle
    0, 2, 3, // second triangle
  ]);  

  // vertex buffer for both positions and colors
  const vertexBuffer = device.createBuffer({
    label: 'vertex position buffer of both positions and colors for two triangles',
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertexData);

  // index buffer for the two triangles
  const indexBuffer = device.createBuffer({
    label: 'index buffer for two triangles',
    size: indexData.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indexData);

  const render = () => {
    const textureView = context.getCurrentTexture().createView(); // the output is a texture, and we are getting a "view" of texture as the output of the render pass
    const renderPassDescriptor = {
      colorAttachments: [{
        view: textureView,
        clearValue: [1.0, 1.0, 1.0, 1.0], // an arbitrary color you prefer
        storeOp: 'store',
        loadOp: 'clear',
      }],
    };

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.setVertexBuffer(0, vertexBuffer);
    passEncoder.setIndexBuffer(indexBuffer, 'uint32');
    passEncoder.drawIndexed(6);
    passEncoder.end();

    // fire up the GPU to render the load value to the output texture
    device.queue.submit([commandEncoder.finish()]);
  };

  function updateMatrixAndRender() {
    if (useRotationTimesTranslation)
      matrix = multiplyMatrices(makeRotationMatrix(angle), makeTranslationMatrix(tx, ty));
    else 
      matrix = multiplyMatrices(makeTranslationMatrix(tx, ty), makeRotationMatrix(angle));
    
    device.queue.writeBuffer(uniformBuffer, 0, matrix);
    render();
  }

  render();

  // add event listener for WASD/QE key controls
  window.addEventListener('keydown', (e) => {
    const moveStep = 0.05;
    const rotStep = 0.05;
    if (e.key === 'a') tx -= moveStep;
    if (e.key === 'd') tx += moveStep;
    if (e.key === 'w') ty += moveStep;
    if (e.key === 's') ty -= moveStep;
    if (e.key === 'q') angle += rotStep;
    if (e.key === 'e') angle -= rotStep;

    updateMatrixAndRender();
  });
}

main();