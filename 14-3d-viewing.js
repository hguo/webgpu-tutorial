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
    label: 'moving the square',
    code: `
      struct Uniforms{
        P: mat4x4<f32>, // projection matrix
        V: mat4x4<f32>, // viewing matrix
        M: mat4x4<f32>, // model matrix
      };
      @group(0) @binding(0) var<uniform> uniforms : Uniforms;

      struct VSIn {
        @location(0) pos : vec3f,
        @location(1) color : vec4f,
      };

      struct VSOut {
        @builtin(position) pos : vec4f,
        @location(0) color : vec4f,
      };

      @vertex fn vs(in : VSIn) -> VSOut
      {
        var out : VSOut;
        out.pos = uniforms.P * uniforms.V * uniforms.M * vec4f(in.pos, 1.0);
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
          arrayStride: 6 * 4, // 5 floating-point numbers with 4 bytes each
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: 'float32x3',
            },
            {
              shaderLocation: 1,
              offset: 3 * 4, // the offset is two floating-point numbers
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
    depthStencil: { // enable depth testing
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  });

  // vertex position and color for a 3D box
  const vertexData = new Float32Array([
    -1.0, -1.0, -1.0,  1.0, 0.0, 0.0, 
     1.0, -1.0, -1.0,  0.0, 1.0, 0.0,
    -1.0,  1.0, -1.0,  0.0, 0.0, 1.0,
     1.0,  1.0, -1.0,  1.0, 1.0, 0.0, 
    -1.0, -1.0,  1.0,  1.0, 0.0, 1.0, 
     1.0, -1.0,  1.0,  1.0, 1.0, 0.0,
    -1.0,  1.0,  1.0,  1.0, 0.0, 1.0,
     1.0,  1.0,  1.0,  0.0, 1.0, 1.0, 
  ]);

  // indices for the cube
  const indexData = new Uint32Array([
    // front face
    0, 1, 2,  2, 1, 3,
    // back face
    4, 6, 5,  5, 6, 7,
    // left face
    0, 2, 4,  4, 2, 6,
    // right face
    1, 5, 3,  3, 5, 7,
    // top face
    2, 3, 6,  6, 3, 7,
    // bottom face
    0, 4, 1,  1, 4, 5,
  ]);

  // vertex buffer for both positions and colors
  const vertexBuffer = device.createBuffer({
    label: 'cube with colors',
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

  // bind groups for the matrices
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  render = () => {
    const textureView = context.getCurrentTexture().createView(); 
 
    // the depth texture
    const depthTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const depthTextureView = depthTexture.createView();
    
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
    console.log(angle);
    angle += 1.0;
    render();
    requestAnimationFrame(animate);
  }

  animate();
}

main();
