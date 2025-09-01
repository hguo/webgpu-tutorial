async function main()
{
  // get webgpu adapter and device
  const adaptor = await navigator.gpu?.requestAdapter();
  const device = await adaptor?.requestDevice();
  if (!device) {
    fail('your browser does not support WebGPU');
    return;
  }

  const count = 3;
  const A = new Float32Array([1, 2, 3]);
  const B = new Float32Array([4, 5, 6]);

  const bufA = device.createBuffer({
    size: count * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(bufA, 0, A);

  const bufB = device.createBuffer({
    size: count * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(bufB, 0, B);

  const bufC = device.createBuffer({
    size: count * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });

  // Create a readback buffer for mapping
  const readBuffer = device.createBuffer({
    size: count * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  const computeShaderModule = device.createShaderModule({
    label: 'compute C=A+B',
    code: `
      @group(0) @binding(0) var<storage, read_write> A : array<f32>;
      @group(0) @binding(1) var<storage, read_write> B : array<f32>;
      @group(0) @binding(2) var<storage, read_write> C : array<f32>;

      @compute @workgroup_size(1)
      fn main(@builtin(global_invocation_id) id : vec3<u32>) {
        let i = id.x;
        C[i] = A[i] + B[i];
      }
    `,
  });

  const computeBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });

  const computeBindGroup = device.createBindGroup({
    layout: computeBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: bufA } },
      { binding: 1, resource: { buffer: bufB } },
      { binding: 2, resource: { buffer: bufC } },
    ],
  });

  const computePipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [computeBindGroupLayout],
  });

  const computePipeline = device.createComputePipeline({
    layout: computePipelineLayout,
    compute: { module: computeShaderModule, entryPoint: 'main' },
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(computePipeline);
  pass.setBindGroup(0, computeBindGroup);
  pass.dispatchWorkgroups(count);
  pass.end();

  // Copy result from bufC to readBuffer
  encoder.copyBufferToBuffer(bufC, 0, readBuffer, 0, count * 4);

  device.queue.submit([encoder.finish()]);

  await readBuffer.mapAsync(GPUMapMode.READ);
  const arrayBuffer = readBuffer.getMappedRange();
  const C = new Float32Array(arrayBuffer);

  console.log(C);
}

main();
