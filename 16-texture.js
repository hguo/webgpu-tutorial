let render;

// projection, viewing, and model matrices
var P = glMatrix.mat4.create();
var V = glMatrix.mat4.create();
var M = glMatrix.mat4.create();

let angle = 0.0; // rotation angle

function degToRad(degrees) {
  return degrees * Math.PI / 180;
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
    label: 'textured box',
    code: `
      struct Uniforms{
        P: mat4x4<f32>,
        V: mat4x4<f32>,
        M: mat4x4<f32>,
      };
      @group(0) @binding(0) var<uniform> uniforms : Uniforms;
      @group(0) @binding(1) var mySampler: sampler;
      @group(0) @binding(2) var myTexture: texture_2d<f32>;

      struct VSIn {
        @location(0) pos : vec3f,
        @location(1) uv : vec2f,
      };

      struct VSOut {
        @builtin(position) pos : vec4f,
        @location(0) uv : vec2f,
      };

      @vertex fn vs(in : VSIn) -> VSOut
      {
        var out : VSOut;
        out.pos = uniforms.P * uniforms.V * uniforms.M * vec4f(in.pos, 1.0);
        out.uv = in.uv;
        return out;
      }

      @fragment fn fs(vsOut : VSOut) -> @location(0) vec4f 
      {
        let texColor = textureSample(myTexture, mySampler, vsOut.uv);
        return texColor;
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
          arrayStride: 5 * 4, // 3 (pos) + 2 (uv)
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' }, // pos
            { shaderLocation: 1, offset: 3 * 4, format: 'float32x2' }, // uv
          ]
        },
      ],
    },
    fragment: {
      entryPoint: 'fs',
      module: module,
      targets: [{ format: format }],
    },
    depthStencil: { // enable depth testing
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  });

  // vertex position and color for a 3D box
  // Each face has 4 unique vertices (24 total), each with its own UVs
  const vertexData = new Float32Array([
    // Front face
    -1, -1,  1,  0, 0,
     1, -1,  1,  1, 0,
    -1,  1,  1,  0, 1,
     1,  1,  1,  1, 1,
    // Back face
     1, -1, -1,  0, 0,
    -1, -1, -1,  1, 0,
     1,  1, -1,  0, 1,
    -1,  1, -1,  1, 1,
    // Left face
    -1, -1, -1,  0, 0,
    -1, -1,  1,  1, 0,
    -1,  1, -1,  0, 1,
    -1,  1,  1,  1, 1,
    // Right face
     1, -1,  1,  0, 0,
     1, -1, -1,  1, 0,
     1,  1,  1,  0, 1,
     1,  1, -1,  1, 1,
    // Top face
    -1,  1,  1,  0, 0,
     1,  1,  1,  1, 0,
    -1,  1, -1,  0, 1,
     1,  1, -1,  1, 1,
    // Bottom face
    -1, -1, -1,  0, 0,
     1, -1, -1,  1, 0,
    -1, -1,  1,  0, 1,
     1, -1,  1,  1, 1,
  ]);

  const indexData = new Uint32Array([
    // Front face
    0, 1, 2,  2, 1, 3,
    // Back face
    4, 5, 6,  6, 5, 7,
    // Left face
    8, 9,10, 10, 9,11,
    // Right face
    12,13,14, 14,13,15,
    // Top face
    16,17,18, 18,17,19,
    // Bottom face
    20,21,22, 22,21,23,
  ]);

  // vertex buffer for both positions and colors
  const vertexBuffer = device.createBuffer({
    label: 'cube with texcoords',
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertexData);

  // index buffer for the cube
  const indexBuffer = device.createBuffer({
    label: 'cube with colors',
    size: indexData.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indexData);

  // uniform buffers for the matrices
  const uniformBuffer = device.createBuffer({
    size: 3 * 16 * 4, // model, view, and projection matrices
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Load the texture and create GPU resources
  const img = new Image();
  img.src = 'brick.png';
  await img.decode();

  const imageBitmap = await createImageBitmap(img);
  const texture = device.createTexture({
    size: [imageBitmap.width, imageBitmap.height, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture(
    { source: imageBitmap },
    { texture: texture },
    [imageBitmap.width, imageBitmap.height]
  );

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });

  // Now create the bind group after sampler and texture are created
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: texture.createView() },
    ],
  });
    
  // the depth texture
  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const depthTextureView = depthTexture.createView();
    

  render = () => {
    const textureView = context.getCurrentTexture().createView(); 

    const renderPassDescriptor = {
      colorAttachments: [{
        view: textureView,
        clearValue: [1.0, 1.0, 1.0, 1.0],
        storeOp: 'store',
        loadOp: 'clear',
      }],
      depthStencilAttachment: { // add the depth stencil attachment to enable the depth test
        view: depthTextureView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    };

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.setVertexBuffer(0, vertexBuffer);
    passEncoder.setIndexBuffer(indexBuffer, 'uint32');

    passEncoder.setBindGroup(0, bindGroup);
  
    // projection
    glMatrix.mat4.identity(P);
    glMatrix.mat4.perspective(P, degToRad(45), 1.0, 0.1, 100);
    // glMatrix.mat4.perspective(P, 45, 1.0, 0.1, 100);  // set up the projection matrix 
    device.queue.writeBuffer(uniformBuffer, 0, P);

    // viewing
    glMatrix.mat4.identity(V);
    glMatrix.mat4.lookAt(V, [0,0,5], [0,0,0], [0,1,0]);	// set up the view matrix, multiply into the modelview matrix
    device.queue.writeBuffer(uniformBuffer, 16*4, V);

    // model
    glMatrix.mat4.identity(M);
    glMatrix.mat4.rotateY(M, M, degToRad(angle)); // rotate the cube around the Y axis
    device.queue.writeBuffer(uniformBuffer, 32*4, M);

    passEncoder.drawIndexed(indexData.length);

    passEncoder.end();

    // fire up the GPU to render the load value to the output texture
    device.queue.submit([commandEncoder.finish()]);
  };

  function animate() {
    angle += 1.0;
    render();
    requestAnimationFrame(animate);
  }

  animate();
}

main();
