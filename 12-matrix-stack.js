// status for the rotation and translation control
var sunTrans = [0.0, 0.0];
var sunScale = [0.25, 0.25];
var sunRot = 30;
var sunMatrix = glMatrix.mat4.create();

var earthTrans = [2.0, 0.0];
var earthScale = [0.5, 0.5];
var earthRot = 60;
var earthMatrix = glMatrix.mat4.create();

var moonTrans = [2.0, 0.0];
var moonScale = [0.25, 0.25];
var moonRot = 45;
var moonMatrix = glMatrix.mat4.create();

var marsTrans = [2.0, 0.0];
var marsScale = [0.5, 0.5];
var marsRot = 30;
var marsMatrix = glMatrix.mat4.create();

let render;

function degToRad(degrees) {
  return degrees * Math.PI / 180;
}

async function updateTransformations() {
  // Read values from the form
  var vSunTrans = parseFloat(document.getElementById("sunTrans").value);
  var vSunScale = parseFloat(document.getElementById("sunScale").value);
  var vSunRot = parseFloat(document.getElementById("sunRot").value);
  var vEarthTrans = parseFloat(document.getElementById("earthTrans").value);
  var vEarthScale = parseFloat(document.getElementById("earthScale").value);
  var vEarthRot = parseFloat(document.getElementById("earthRot").value);
  var vMoonTrans = parseFloat(document.getElementById("moonTrans").value);
  var vMoonScale = parseFloat(document.getElementById("moonScale").value);
  var vMoonRot = parseFloat(document.getElementById("moonRot").value);
  var vMarsTrans = parseFloat(document.getElementById("marsTrans").value);
  var vMarsScale = parseFloat(document.getElementById("marsScale").value);
  var vMarsRot = parseFloat(document.getElementById("marsRot").value);

  // Matrix stack
  let stack = [];
  let M = glMatrix.mat4.create();

  // --- Sun ---
  glMatrix.mat4.identity(M);
  glMatrix.mat4.translate(M, M, [vSunTrans, 0, 0]);
  glMatrix.mat4.scale(M, M, [vSunScale, vSunScale, 1]);
  glMatrix.mat4.rotate(M, M, degToRad(vSunRot), [0, 0, 1]);
  glMatrix.mat4.copy(sunMatrix, M);

  // Push sun matrix
  stack.push(glMatrix.mat4.clone(M));

  // --- Earth ---
  glMatrix.mat4.translate(M, M, [vEarthTrans, 0, 0]);
  glMatrix.mat4.scale(M, M, [vEarthScale, vEarthScale, 1]);
  glMatrix.mat4.rotate(M, M, degToRad(vEarthRot), [0, 0, 1]);
  glMatrix.mat4.copy(earthMatrix, M);

  // Push earth matrix
  stack.push(glMatrix.mat4.clone(M));

  // --- Moon ---
  glMatrix.mat4.translate(M, M, [vMoonTrans, 0, 0]);
  glMatrix.mat4.scale(M, M, [vMoonScale, vMoonScale, 1]);
  glMatrix.mat4.rotate(M, M, degToRad(vMoonRot), [0, 0, 1]);
  glMatrix.mat4.copy(moonMatrix, M);

  // Pop earth matrix
  M = stack.pop();

  // Pop sun matrix
  M = stack.pop();

  // --- Mars (as another child of Sun) ---
  glMatrix.mat4.translate(M, M, [vMarsTrans, 0, 0]);
  glMatrix.mat4.scale(M, M, [vMarsScale, vMarsScale, 1]);
  glMatrix.mat4.rotate(M, M, degToRad(vMarsRot), [0, 0, 1]);
  glMatrix.mat4.copy(marsMatrix, M);

  render();
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

  // vertex position and color data in one buffer, now removed 
  const vertexData = new Float32Array([
    -1.0, -1.0, 1.0, 0.0, 0.0, 
     1.0, -1.0, 0.0, 1.0, 0.0,
     1.0,  1.0, 0.0, 0.0, 1.0,
    -1.0,  1.0, 1.0, 1.0, 0.0,
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

  // uniform buffers for the sun, earth, and moon
  const sunUniformBuffer = device.createBuffer({
    size: 16 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const earthUniformBuffer = device.createBuffer({
    size: 16 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const moonUniformBuffer = device.createBuffer({
    size: 16 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const marsUniformBuffer = device.createBuffer({
    size: 16 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // bind groups for the sun, earth, and moon
  const sunBindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: sunUniformBuffer } }],
  });
  const earthBindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: earthUniformBuffer } }],
  });
  const moonBindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: moonUniformBuffer } }],
  });
  const marsBindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: marsUniformBuffer } }],
  });

  render = () => {
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
    passEncoder.setVertexBuffer(0, vertexBuffer);
    passEncoder.setIndexBuffer(indexBuffer, 'uint32');

    passEncoder.setBindGroup(0, sunBindGroup);
    device.queue.writeBuffer(sunUniformBuffer, 0, sunMatrix);
    passEncoder.drawIndexed(6);

    passEncoder.setBindGroup(0, earthBindGroup);
    device.queue.writeBuffer(earthUniformBuffer, 0, earthMatrix);
    passEncoder.drawIndexed(6);

    passEncoder.setBindGroup(0, moonBindGroup);
    device.queue.writeBuffer(moonUniformBuffer, 0, moonMatrix);
    passEncoder.drawIndexed(6);

    passEncoder.setBindGroup(0, marsBindGroup);
    device.queue.writeBuffer(marsUniformBuffer, 0, marsMatrix);
    passEncoder.drawIndexed(6);

    passEncoder.end();

    // fire up the GPU to render the load value to the output texture
    device.queue.submit([commandEncoder.finish()]);
  };

  updateTransformations();
  render();
}

main();