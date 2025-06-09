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
        offset: vec2f,
      };
      @group(0) @binding(0) var<uniform> uniforms : Uniforms;

      struct VSOut {
        @builtin(position) pos : vec4f,
        @location(0) color : vec4f,
      };

      @vertex fn vs(
        @location(0) pos : vec2f, 
        @location(1) color : vec4f
      ) -> VSOut
      {
        var out : VSOut;
        out.pos = vec4f(pos + uniforms.offset, 0.0, 1.0);
        out.color = color;
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

  // the uniform variable for the offset
  let offset = new Float32Array([0, 0]);
  const uniformBuffer = device.createBuffer({
    size: 2 * 4, // two floating-point numbers with 4 bytes each
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, offset);

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
    0.0, 0.0, 1.0, 0.0, 0.0, 
    0.5, 0.0, 0.0, 1.0, 0.0,
    0.5, 0.5, 0.0, 0.0, 1.0,
    0.0, 0.5, 1.0, 1.0, 0.0,
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
    passEncoder.setBindGroup(0, bindGroup); // set bind group here
    passEncoder.setVertexBuffer(0, vertexBuffer);
    passEncoder.setIndexBuffer(indexBuffer, 'uint32');
    passEncoder.drawIndexed(6);
    passEncoder.end();

    // fire up the GPU to render the load value to the output texture
    device.queue.submit([commandEncoder.finish()]);
  };

  render();

  // add event listener for WASD key controls
  window.addEventListener('keydown', (e) => {
    const step = 0.05;
    if (e.key === 'a') offset[0] -= step;
    if (e.key === 'd') offset[0] += step;
    if (e.key === 'w') offset[1] += step;
    if (e.key === 's') offset[1] -= step;
    device.queue.writeBuffer(uniformBuffer, 0, offset);
    render();
  });
}

main();
