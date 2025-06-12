let render;

// projection, viewing, and model matrices
var projMatrix = glMatrix.mat4.create();
var viewMatrix = glMatrix.mat4.create();
var modelMatrix = glMatrix.mat4.create();
var normalMatrix = glMatrix.mat4.create();
var lightDirection = glMatrix.vec3.fromValues(1.0, -1.0, 1.0);
var ambientColor = glMatrix.vec3.fromValues(0.2, 0.2, 0.2);
var diffuseColor = glMatrix.vec3.fromValues(1.0, 1.0, 1.0);
var specularColor = glMatrix.vec3.fromValues(1.0, 1.0, 1.0);
var Ka = 0.5; // ambient reflectivity
var Kd = 0.2; // diffuse reflectivity
var Ks = 1.0; // specular reflectivity
var shininess = 30.0; // shininess factor for specular highlights
var cameraPosition = glMatrix.vec3.fromValues(0.0, 0.0, 60.0);

var angle = 0.0; // rotation angle

function degToRad(degrees) {
  return degrees * Math.PI / 180;
}

async function loadJSON(device, url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!data) {
    fail('failed to load teapot data');
    return;
  }

  const positions = new Float32Array(data.vertexPositions);
  const normals = new Float32Array(data.vertexNormals);
  const texcoords = new Float32Array(data.vertexTextureCoords);
  const indices = new Uint32Array(data.indices);

  // create a data buffer to interleave the vertex data
  const interleavedData = new Float32Array(positions.length + normals.length + texcoords.length);
  for (let i = 0, j = 0; i < positions.length; i += 3, j += 8) {
    interleavedData[j] = positions[i];
    interleavedData[j + 1] = positions[i + 1];
    interleavedData[j + 2] = positions[i + 2];
    interleavedData[j + 3] = normals[i];
    interleavedData[j + 4] = normals[i + 1];
    interleavedData[j + 5] = normals[i + 2];
    interleavedData[j + 6] = texcoords[i];
    interleavedData[j + 7] = texcoords[i + 1];
  }

  const vertex = device.createBuffer({
    label: 'vertex buffer',
    size: positions.byteLength + normals.byteLength + texcoords.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertex, 0, interleavedData);

  const index = device.createBuffer({
    label: 'index buffer',
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(index, 0, indices);

  return {
    vertex, index, 
    vertexCount: positions.length / 3, 
    indexCount: indices.length
  };
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
    label: 'simple lighting',
    code: `
      struct Uniforms{
        projMatrix: mat4x4<f32>,
        viewMatrix: mat4x4<f32>,
        modelMatrix: mat4x4<f32>,
        normalMatrix: mat4x4<f32>,
        lightDirection: vec3f,
        _pad1: f32, // padding to 16 bytes
        ambientColor: vec3f,
        _pad2: f32, // padding to 16 bytes
        diffuseColor: vec3f,
        _pad3: f32, // padding to 16 bytes
        specularColor: vec3f,
        _pad4: f32, // padding to 16 bytes
        Ka: f32,
        Kd: f32,
        Ks: f32,
        shininess: f32,
        cameraPosition: vec3f,
        _pad: f32, // padding to 16 bytes
      };
      @group(0) @binding(0) var<uniform> uniforms : Uniforms;

      struct VSIn {
        @location(0) pos : vec3f,
        @location(1) normal : vec3f,
        @location(2) texcoords : vec2f,
      };

      struct VSOut {
        @builtin(position) pos : vec4f,
        @location(0) color : vec4f,
      };

      @vertex fn vs(in : VSIn) -> VSOut
      {
        var out : VSOut;
        
        out.pos = uniforms.projMatrix * uniforms.viewMatrix * uniforms.modelMatrix * vec4f(in.pos, 1.0);

        // position in the eye space
        let pos_in_eye_space = (uniforms.viewMatrix * uniforms.modelMatrix * vec4f(in.pos, 1.0)).xyz;

        // light direction in the eye space
        var light_dir_in_eye_space = normalize((uniforms.viewMatrix * vec4f(uniforms.lightDirection, 0.0)).xyz);

        // normal in the eye space
        var normal_in_eye_space = normalize((uniforms.normalMatrix * vec4f(in.normal, 0.0)).xyz);
        
        // viewing direction in the eye space
        var viewing_dir_in_eye_space = normalize(-uniforms.cameraPosition);

        let ambient = uniforms.ambientColor * uniforms.Ka;
        let diff = max(dot(normal_in_eye_space, light_dir_in_eye_space), 0.0);
        let diffuse = uniforms.diffuseColor * uniforms.Kd * diff;

        let reflectDir = reflect(-light_dir_in_eye_space, normal_in_eye_space);
        let spec = pow(max(dot(viewing_dir_in_eye_space, reflectDir), 0.0), uniforms.shininess);
        let specular = uniforms.specularColor * uniforms.Ks * spec;

        out.color = vec4(ambient + diffuse + specular, 1.0); 
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
          arrayStride: 8 * 4,
          attributes: [
            {
              shaderLocation: 0,  // position
              offset: 0,
              format: 'float32x3',
            },
            {
              shaderLocation: 1,  // normals
              offset: 3 * 4, // the offset is two floating-point numbers
              format: 'float32x3',
            },
            {
              shaderLocation: 2,  // texcoords
              offset: 6 * 4, // the offset is three floating-point numbers
              format: 'float32x2',
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

  const teapotData = await loadJSON(device, 'teapot.json');

  // uniform buffers
  const uniformBuffer = device.createBuffer({
    size: 4 * 16 * 4 // 4 matrices
      + 4 * 4 * 4   // 4 vec3 (lightDirection, ambientColor, diffuseColor, specularColor)
      + 4 * 4       // 4 f32 (Ka, Kd, Ks, shininess)
      + 4 * 4       // cameraPosition (vec3)
      + 4,          // _pad
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // bind groups
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
    passEncoder.setVertexBuffer(0, teapotData.vertex);
    passEncoder.setIndexBuffer(teapotData.index, 'uint32');

    passEncoder.setBindGroup(0, bindGroup);
  
    // projection
    glMatrix.mat4.identity(projMatrix);
    glMatrix.mat4.perspective(projMatrix, degToRad(45), 1.0, 0.1, 100);
    device.queue.writeBuffer(uniformBuffer, 0, projMatrix);

    // viewing
    glMatrix.mat4.identity(viewMatrix);
    glMatrix.mat4.lookAt(viewMatrix, cameraPosition, [0,0,0], [0,1,0]);
    device.queue.writeBuffer(uniformBuffer, 16*4, viewMatrix);

    // model
    glMatrix.mat4.identity(modelMatrix);
    glMatrix.mat4.rotateY(modelMatrix, modelMatrix, degToRad(angle));
    device.queue.writeBuffer(uniformBuffer, 32*4, modelMatrix);

    // normal matrix
    glMatrix.mat4.identity(normalMatrix);
    glMatrix.mat4.invert(normalMatrix, modelMatrix);
    glMatrix.mat4.transpose(normalMatrix, normalMatrix);
    device.queue.writeBuffer(uniformBuffer, 48*4, normalMatrix);

    // lightDirection (vec3)
    device.queue.writeBuffer(uniformBuffer, 64*4, lightDirection);
    // ambientColor (vec3)
    device.queue.writeBuffer(uniformBuffer, 64*4 + 4*4, ambientColor);
    // diffuseColor (vec3)
    device.queue.writeBuffer(uniformBuffer, 64*4 + 8*4, diffuseColor);
    // specularColor (vec3)
    device.queue.writeBuffer(uniformBuffer, 64*4 + 12*4, specularColor);

    // Ka, Kd, Ks, shininess (all f32)
    device.queue.writeBuffer(uniformBuffer, 64*4 + 16*4, new Float32Array([Ka, Kd, Ks, shininess]));

    // cameraPosition (vec3)
    device.queue.writeBuffer(uniformBuffer, 64*4 + 20*4, cameraPosition);

    passEncoder.drawIndexed(teapotData.indexCount);

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
