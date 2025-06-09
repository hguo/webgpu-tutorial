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

  // vertex and fragment shader (in one single module)
  const module = device.createShaderModule({
    label: 'vertex buffer triangle',
    code: `
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
        out.pos = vec4f(pos, 0.0, 1.0);
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
          arrayStride: 2 * 4, // 2 floating-point numbers with 4 bytes each
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: 'float32x2',
            },
          ]
        },
        {
          arrayStride: 3 * 4, // 3 floating-point numbers with 4 bytes each
          attributes: [
            {
              shaderLocation: 1,
              offset: 0,
              format: 'float32x3',
            },
          ]
        }
      ],
    },
    fragment: {
      entryPoint: 'fs',
      module: module,
      targets: [{ format: format }],
    },
  });

  // vertex position data
  const vertexPositionData = new Float32Array([
    0.0, 0.0,
    0.5, 0.0,
    0.5, 0.5,
    0.0, 0.0,
    0.5, 0.5,
    0.0, 0.5,
  ]);

  // vertex buffer for positions
  const vertexPositionBuffer = device.createBuffer({
    label: 'vertex position buffer for two triangles',
    size: vertexPositionData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexPositionBuffer, 0, vertexPositionData);
  
  // vertex color data
  const vertexColorData = new Float32Array([
    1.0, 0.0, 0.0, 
    0.0, 1.0, 0.0,
    0.0, 0.0, 1.0,
    1.0, 0.0, 0.0, 
    0.0, 0.0, 1.0,
    1.0, 1.0, 0.0
  ]);

  // vertex buffer for colors
  const vertexColorBuffer = device.createBuffer({
    label: 'vertex color buffer for two triangles',
    size: vertexColorData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexColorBuffer, 0, vertexColorData);

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
    passEncoder.setVertexBuffer(0, vertexPositionBuffer);
    passEncoder.setVertexBuffer(1, vertexColorBuffer);
    passEncoder.draw(vertexPositionData.length / 2); 
    passEncoder.end();

    // fire up the GPU to render the load value to the output texture
    device.queue.submit([commandEncoder.finish()]);
  };

  render();
}

main();
