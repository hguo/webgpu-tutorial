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

  // vertex and fragment shaders in one single module
  const module = device.createShaderModule({
    label: 'hardcoded color triangle',
    code: `
      struct VSOut {
        @builtin(position) pos : vec4f,
        @location(0) color : vec4f,
      };

      @vertex fn vs(@builtin(vertex_index) vertexIndex: u32) 
        -> VSOut
      {
        var pos : vec4f;
        var color : vec4f;

        if (vertexIndex == 0) {
          pos = vec4f(0.0, 0.0, 0.0, 1.0);
          color = vec4f(1.0, 0.0, 0.0, 1.0);
        } else if (vertexIndex == 1) {
          pos = vec4f(0.5, 0.0, 0.0, 1.0);
          color = vec4f(0.0, 1.0, 0.0, 1.0);
        } else if (vertexIndex == 2) {
          pos = vec4f(0.0, 0.5, 0.0, 1.0);
          color = vec4f(0.0, 0.0, 1.0, 1.0);
        }

        return VSOut(pos, color);
      }
      
      @fragment fn fs(in : VSOut)
        -> @location(0) vec4f 
      {
        return in.color;
      }
    `,
  });

  // the rendering pipeline
  const pipeline = device.createRenderPipeline({
    label: 'hardcoded triangle pipeline',
    layout: 'auto',
    vertex: {
      module: module
    },
    fragment: {
      module: module,
      targets: [{ format: format }],
    },
  });

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
    passEncoder.draw(3); // draw three vertices
    passEncoder.end();

    // fire up the GPU to render the load value to the output texture
    device.queue.submit([commandEncoder.finish()]);
  };

  render();
}

main();
