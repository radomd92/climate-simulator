export class ShaderProgram {
  constructor(gl, vertexSource, fragmentSource, name) {
    this.gl = gl;
    this.program = gl.createProgram();

    const vertexShader = this.compile(gl.VERTEX_SHADER, vertexSource, `${name} vertex`);
    const fragmentShader = this.compile(gl.FRAGMENT_SHADER, fragmentSource, `${name} fragment`);

    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error(`${name} program failed to link:\n${gl.getProgramInfoLog(this.program)}`);
    }

    this.uniforms = new Map();
    const uniformCount = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
    for (let index = 0; index < uniformCount; index += 1) {
      const uniform = gl.getActiveUniform(this.program, index);
      this.uniforms.set(uniform.name, gl.getUniformLocation(this.program, uniform.name));
    }
  }

  compile(type, source, name) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const message = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error(`${name} shader failed to compile:\n${message}`);
    }

    return shader;
  }

  use() {
    this.gl.useProgram(this.program);
  }

  setInteger(name, value) {
    const location = this.uniforms.get(name);
    if (location !== undefined && location !== null) {
      this.gl.uniform1i(location, value);
    }
  }

  setFloat(name, value) {
    const location = this.uniforms.get(name);
    if (location !== undefined && location !== null) {
      this.gl.uniform1f(location, value);
    }
  }

  setVector2(name, [x, y]) {
    const location = this.uniforms.get(name);
    if (location !== undefined && location !== null) {
      this.gl.uniform2f(location, x, y);
    }
  }

  setVector4(name, [x, y, z, w]) {
    const location = this.uniforms.get(name);
    if (location !== undefined && location !== null) {
      this.gl.uniform4f(location, x, y, z, w);
    }
  }

  setTexture(name, unit, texture) {
    texture.bind(unit);
    this.setInteger(name, unit);
  }
}

export class Mesh {
  constructor(gl, vertices, primitive) {
    this.gl = gl;
    this.primitive = primitive;
    this.vertexCount = vertices.length / 3;
    this.vertexArray = gl.createVertexArray();
    this.buffer = gl.createBuffer();

    gl.bindVertexArray(this.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  draw() {
    this.gl.bindVertexArray(this.vertexArray);
    this.gl.drawArrays(this.primitive, 0, this.vertexCount);
  }
}

export class Texture2D {
  constructor(gl) {
    this.gl = gl;
    this.texture = gl.createTexture();
  }

  static load(gl, path, options = {}) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener("load", () => {
        const texture = new Texture2D(gl);
        texture.bind();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, image);
        texture.setSampling(options);
        resolve(texture);
      });
      image.addEventListener("error", () => reject(new Error(`Unable to load image: ${path}`)));
      image.src = path;
    });
  }

  static allocate(gl, width, height, internalFormat, format, type) {
    const texture = new Texture2D(gl);
    texture.bind();
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      width,
      height,
      0,
      format,
      type,
      null,
    );
    texture.setSampling();
    return texture;
  }

  bind(unit = null) {
    if (unit !== null) {
      this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    }
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
  }

  setSampling({ linear = false, repeatX = false } = {}) {
    this.bind();
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeatX ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  uploadData(width, height, format, type, data) {
    const gl = this.gl;
    const previousFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    this.bind();
    // CPU arrays already use WebGL's bottom-to-top texture-coordinate order.
    // Image assets need the global Y flip, but applying it here would mirror
    // generated fields across the equator.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    try {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        width,
        height,
        format,
        type,
        data,
      );
    } finally {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, previousFlipY);
    }
  }

  destroy() {
    this.gl.deleteTexture(this.texture);
  }
}

export class Framebuffer {
  constructor(gl) {
    this.gl = gl;
    this.framebuffer = gl.createFramebuffer();
  }

  attachColor(texture, index) {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0 + index,
      this.gl.TEXTURE_2D,
      texture.texture,
      0,
    );
  }

  validate(name) {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
    const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
    if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`${name} framebuffer is incomplete (WebGL status ${status}).`);
    }
  }

  use(colorAttachments) {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
    this.gl.drawBuffers(colorAttachments.map((index) => this.gl.COLOR_ATTACHMENT0 + index));
  }
}

