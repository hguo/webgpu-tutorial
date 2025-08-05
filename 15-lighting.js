let render;

// projection, viewing, and model matrices
var projMatrix = glMatrix.mat4.create();
var viewMatrix = glMatrix.mat4.create();
var modelMatrix = glMatrix.mat4.create();
var normalMatrix = glMatrix.mat4.create();
var lightPosition = glMatrix.vec3.fromValues(10.0, 10.0, 10.0); // in world space
var cameraPosition = glMatrix.vec3.fromValues(0.0, 0.0, 60.0);
var ambientColor = glMatrix.vec3.fromValues(0.2, 0.2, 0.2);
var diffuseColor = glMatrix.vec3.fromValues(1.0, 1.0, 1.0);
var specularColor = glMatrix.vec3.fromValues(1.0, 1.0, 1.0);
var Ka = 0.5; // ambient reflectivity
var Kd = 0.4; // diffuse reflectivity
var Ks = 1.0; // specular reflectivity
var shininess = 100.0; // shininess factor for specular highlights

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
        lightPosition: vec3f,
        cameraPosition: vec3f,
        ambientColor: vec3f,
        diffuseColor: vec3f,
        specularColor: vec3f,
        _pad1: f32,
        Ka: f32,
        Kd: f32,
        Ks: f32,
        shininess: f32,
        _pad: vec3f, // padding to 16-byte alignment
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
        // position in the eye space
        let pos_in_eye_space = (uniforms.viewMatrix * uniforms.modelMatrix * vec4f(in.pos, 1.0)).xyz;

        // light direction in the eye space
        let light_position_in_eye_space = (uniforms.viewMatrix * vec4f(uniforms.lightPosition, 1.0)).xyz;
        var light_dir_in_eye_space = normalize(light_position_in_eye_space - pos_in_eye_space);

        // normal in the eye space
        var normal = normalize((uniforms.normalMatrix * vec4f(in.normal, 0.0)).xyz);
        
        // viewing direction in the eye space
        var eye_vector = normalize(-uniforms.cameraPosition);

        // ambient
        let ambient = uniforms.ambientColor * uniforms.Ka;
        
        // diffuse
        let ndotl = max(dot(normal, light_dir_in_eye_space), 0.0);
        let diffuse = uniforms.diffuseColor * uniforms.Kd * ndotl;

        // specular
        let reflectDir = reflect(light_dir_in_eye_space, normal);
        let rdotv = max(dot(reflectDir, eye_vector), 0.0);
        let spec = pow(rdotv, uniforms.shininess);
        let specular = uniforms.specularColor * uniforms.Ks * spec;

        var out : VSOut;

        out.pos = uniforms.projMatrix * uniforms.viewMatrix * uniforms.modelMatrix * vec4f(in.pos, 1.0);
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

  // --- Uniform buffer size calculation ---
  // 4 matrices: 4*64 = 256 bytes
  // 5 vec3: 5*16 = 80 bytes (lightPosition, ambientColor, diffuseColor, specularColor, cameraPosition)
  // 4 f32: 16 bytes (Ka, Kd, Ks, shininess)
  // 1 vec3: 16 bytes (_pad)
  // Total: 256 + 80 + 16 + 16 = 368 bytes
  const uniformBuffer = device.createBuffer({
    size: 368,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // bind groups
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
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
    passEncoder.setVertexBuffer(0, teapotData.vertex);
    passEncoder.setIndexBuffer(teapotData.index, 'uint32');

    passEncoder.setBindGroup(0, bindGroup);
  
    // projection
    glMatrix.mat4.identity(projMatrix);
    glMatrix.mat4.perspective(projMatrix, degToRad(45), 1.0, 0.1, 100);
    device.queue.writeBuffer(uniformBuffer,   0, projMatrix);

    // viewing
    glMatrix.mat4.identity(viewMatrix);
    glMatrix.mat4.lookAt(viewMatrix, cameraPosition, [0,0,0], [0,1,0]);
    device.queue.writeBuffer(uniformBuffer,  64, viewMatrix);

    // model
    glMatrix.mat4.identity(modelMatrix);
    glMatrix.mat4.rotateY(modelMatrix, modelMatrix, degToRad(angle));
    device.queue.writeBuffer(uniformBuffer, 128, modelMatrix);

    // normal matrix
    glMatrix.mat4.identity(normalMatrix);
    glMatrix.mat4.invert(normalMatrix, modelMatrix);
    glMatrix.mat4.transpose(normalMatrix, normalMatrix);
    device.queue.writeBuffer(uniformBuffer, 192, normalMatrix);

    // lightPosition (vec3)
    device.queue.writeBuffer(uniformBuffer, 256, lightPosition);
    // cameraPosition (vec3)
    device.queue.writeBuffer(uniformBuffer, 272, cameraPosition);
    // ambientColor (vec3)
    device.queue.writeBuffer(uniformBuffer, 288, ambientColor);
    // diffuseColor (vec3)
    device.queue.writeBuffer(uniformBuffer, 304, diffuseColor);
    // specularColor (vec3)
    device.queue.writeBuffer(uniformBuffer, 320, specularColor);
    // Ka, Kd, Ks, shininess (all f32)
    device.queue.writeBuffer(uniformBuffer, 336, new Float32Array([Ka, Kd, Ks, shininess]));

    // draw the object
    passEncoder.drawIndexed(teapotData.indexCount);

    passEncoder.end();
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
